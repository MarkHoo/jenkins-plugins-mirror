import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// ====== 全局错误处理 ======
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  process.exit(1);
});

// ====== 路径配置 ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIRRORS_FILE = path.join(__dirname, '../config/mirrors.json');
const OUTPUT_FILE = path.join(__dirname, '../public/update-center.json');

// ====== 配置参数 ======
const TEST_PLUGIN = 'git';
const TIMEOUT = 15000; // 15秒超时
const OFFICIAL_UPDATE_CENTER = 'https://updates.jenkins.io/update-center.json?version=latest';
const USER_AGENT = 'Jenkins-Plugins-Mirror-HealthCheck/1.0 (+https://github.com/your-username/jenkins-plugins-mirror)';

/**
 * 检查单个镜像源的健康状态
 */
async function checkMirror(baseURL) {
  const testUrl = `${baseURL}/plugins/${TEST_PLUGIN}/latest/${TEST_PLUGIN}.hpi`;
  const start = Date.now();

  try {
    const response = await axios.head(testUrl, {
      timeout: TIMEOUT,
      headers: { 
        'User-Agent': USER_AGENT,
        'Accept': '*/*'
      },
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
    
    return {
      url: baseURL,
      healthy: true,
      latency: Date.now() - start,
      status: response.status,
      lastChecked: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    let errorMessage = error.message;
    
    if (error.response) {
      errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
    } else if (error.request) {
      errorMessage = 'No response received (network timeout?)';
    } else if (error.code) {
      errorMessage = error.code;
    }
    
    return {
      url: baseURL,
      healthy: false,
      latency: Infinity,
      status: error.response?.status || 'N/A',
      lastChecked: new Date().toISOString(),
      error: errorMessage
    };
  }
}

/**
 * 选择最佳镜像源
 */
function selectBestMirror(results) {
  const healthy = results.filter(r => r.healthy).sort((a, b) => a.latency - b.latency);
  
  if (healthy.length > 0) {
    console.log('健康镜像（按延迟排序）：');
    healthy.forEach((mirror, index) => {
      console.log(`  ${index + 1}. ${mirror.url} → ${mirror.latency}ms`);
    });
    return healthy[0].url;
  }
  
  console.warn('所有镜像均不可用！使用轮询策略');
  
  const sortedByTime = [...results].sort((a, b) => 
    new Date(b.lastChecked) - new Date(a.lastChecked)
  );
  
  const candidates = sortedByTime.slice(0, Math.min(3, sortedByTime.length));
  const randomIndex = Math.floor(Math.random() * candidates.length);
  const fallbackMirror = candidates[randomIndex].url;
  
  console.log(`使用轮询镜像: ${fallbackMirror}`);
  return fallbackMirror;
}

/**
 * 解析官方响应（处理 updateCenter.post 格式）
 */
function parseOfficialResponse(responseData) {
  // 检查是否是 HTML 错误页面
  if (typeof responseData === 'string' && responseData.startsWith('<')) {
    console.error('官方源返回 HTML 内容，不是 JSON');
    console.error('可能是 Jenkins 官方服务暂时不可用');
    console.error('建议稍后重试，或检查官方状态：https://status.jenkins.io');
    return null;
  }

  // 检查是否是 updateCenter.post 格式
  if (typeof responseData === 'string' && responseData.includes('updateCenter.post(')) {
    console.log('🔍 检测到 Jenkins 官方返回 updateCenter.post 格式，尝试提取 JSON...');
    
    // 使用正则表达式提取 JSON 部分
    const match = responseData.match(/updateCenter\.post\(([\s\S]+?)\);/);
    if (match && match[1]) {
      const jsonStr = match[1].trim();
      
      try {
        console.log('成功提取 JSON 部分，开始解析...');
        return JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('无法解析提取的 JSON:', parseError.message);
        console.error('提取的 JSON 片段:', jsonStr.substring(0, 300) + '...');
        return null;
      }
    } else {
      console.error('无法从 updateCenter.post 格式中提取 JSON');
      return null;
    }
  }

  // 尝试直接解析为 JSON
  try {
    return JSON.parse(responseData);
  } catch (parseError) {
    console.error('无法解析官方响应为 JSON:', parseError.message);
    console.error('原始响应片段:', responseData.substring(0, 300) + '...');
    return null;
  }
}

/**
 * 生成 update-center.json
 */
async function generateUpdateCenter(bestMirror) {
  try {
    console.log(`尝试从官方源获取 update-center.json: ${OFFICIAL_UPDATE_CENTER}`);
    
    // 获取官方 update-center.json
    const response = await axios.get(OFFICIAL_UPDATE_CENTER, {
      timeout: 15000,
      headers: { 
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });
    
    // 检查状态码
    if (response.status !== 200) {
      console.error(`官方源返回非 200 状态: ${response.status}`);
      console.error('响应内容:', response.data.substring(0, 300) + '...');
      throw new Error(`Official update-center.json returned status ${response.status}`);
    }
    
    // 尝试解析响应
    const data = parseOfficialResponse(response.data);
    
    if (!data) {
      throw new Error('Failed to parse official response');
    }
    
    // 验证数据结构
    if (!data.plugins || typeof data.plugins !== 'object' || Object.keys(data.plugins).length === 0) {
      console.error('❌ 无效的 plugins 结构:', JSON.stringify(data.plugins, null, 2));
      throw new Error('Invalid update-center.json structure');
    }
    
    // 重写插件下载链接
    const pluginBase = `${bestMirror}/plugins`;
    let modifiedCount = 0;
    let skippedCount = 0;
    
    Object.values(data.plugins).forEach(plugin => {
      if (plugin.name && typeof plugin.name === 'string') {
        plugin.archiveUrl = `${pluginBase}/${plugin.name}/latest/${plugin.name}.hpi`;
        modifiedCount++;
      } else {
        skippedCount++;
        console.warn(`跳过无效插件:`, plugin);
      }
    });
    
    console.log(`重写插件链接: ${modifiedCount} 个成功, ${skippedCount} 个跳过`);
    
    // Jenkins 要求的特殊格式
    const finalJson = {
      updateCenter: data,
      _metadata: {
        generatedAt: new Date().toISOString(),
        bestMirror: bestMirror,
        mirrorsChecked: 10,
        pluginsModified: modifiedCount,
        officialSource: OFFICIAL_UPDATE_CENTER,
        generator: 'jenkins-plugins-mirror (https://github.com/your-username/jenkins-plugins-mirror)'
      }
    };
    
    // 写入文件
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(finalJson, null, 2));
    console.log(`成功生成 update-center.json，使用镜像: ${bestMirror}`);
    console.log(`文件已保存至: ${OUTPUT_FILE}`);
    
    return true;
    
  } catch (error) {
    console.error('生成 update-center.json 失败:', error.message);
    console.error('错误详情:');
    console.error(error.stack || error);
    
    // 保存调试信息
    try {
      const debugFile = path.join(__dirname, 'debug-official-response.json');
      await fs.writeFile(debugFile, JSON.stringify({
        error: error.message,
        status: error.response?.status,
        response: error.response?.data?.substring(0, 1000) || error.message
      }, null, 2));
      console.log(`已保存调试信息到: ${debugFile}`);
    } catch (writeError) {
      console.warn('无法保存调试文件:', writeError.message);
    }
    
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('开始 Jenkins Plugins Mirror 健康检查...');
  console.log(`当前时间: ${new Date().toISOString()}`);
  
  try {
    // 读取镜像列表
    const mirrorsContent = await fs.readFile(MIRRORS_FILE, 'utf8');
    const mirrors = JSON.parse(mirrorsContent);
    
    if (!Array.isArray(mirrors) || mirrors.length === 0) {
      throw new Error(`无效的 mirrors.json 格式，应为非空数组`);
    }
    
    console.log(`检查 ${mirrors.length} 个镜像源...`);
    
    // 并行健康检查
    const results = await Promise.all(mirrors.map(checkMirror));
    
    // 打印详细健康检查结果
    console.log('\n详细健康检查结果:');
    results.forEach(result => {
      const status = result.healthy ? '可用' : '不可用';
      const errorInfo = result.error ? ` (错误: ${result.error})` : '';
      console.log(`  ${status} ${result.url} - ${result.latency === Infinity ? '超时' : result.latency + 'ms'}${errorInfo}`);
    });
    
    // 选择最佳镜像
    const bestMirror = selectBestMirror(results);
    
    // 生成 update-center.json
    const success = await generateUpdateCenter(bestMirror);
    
    if (!success) {
      console.error('任务失败：无法生成 update-center.json');
      process.exit(1);
    }
    
    console.log('任务成功完成！');
    
  } catch (error) {
    console.error('严重错误:', error.message);
    console.error(error.stack || error);
    process.exit(1);
  }
}

// 直接运行时执行主函数
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}