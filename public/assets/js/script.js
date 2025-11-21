document.addEventListener('DOMContentLoaded', function() {
    // 动态设置当前年份
    const currentYear = new Date().getFullYear();
    document.getElementById('current-year').textContent = currentYear;
    
    // 404 页面倒计时跳转
    const countdownElement = document.getElementById('countdown');
    if (countdownElement) {
        let seconds = 5;
        
        const interval = setInterval(() => {
            seconds--;
            countdownElement.textContent = seconds;
            
            if (seconds <= 0) {
                clearInterval(interval);
                window.location.href = '/';
            }
        }, 1000);
    }
    
    // 更新最后检查时间
    function updateLastCheckTime() {
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false 
        };
        const lastCheckElement = document.getElementById('last-check');
        if (lastCheckElement) {
            lastCheckElement.textContent = now.toLocaleString('zh-CN', options);
        }
        return now;
    }
    
    // 测量单个镜像站的延迟
    function measureSingleMirror(url) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            const img = new Image();
            let completed = false;
            
            // 设置5秒超时
            const timeoutId = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    resolve({ url, latency: Infinity, success: false });
                }
            }, 5000);
            
            img.onload = img.onerror = function() {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeoutId);
                    const endTime = performance.now();
                    const latency = Math.round(endTime - startTime);
                    resolve({ url, latency, success: true });
                }
            };
            
            // 添加时间戳避免缓存
            img.src = url + '?t=' + Date.now();
        });
    }
    
    // 测量所有镜像站的延迟，返回最快的
    async function measureLatency() {
        const latencyElement = document.getElementById('latency');
        if (!latencyElement) return;
        
        latencyElement.textContent = '测量中...';
        latencyElement.style.color = '#718096';
        
        // 所有镜像站点列表
        const mirrors = [
            "https://mirrors.tuna.tsinghua.edu.cn/jenkins/",
            "https://mirror.nju.edu.cn/jenkins/",
            "https://mirrors.ustc.edu.cn/jenkins/",
            "https://mirrors.bfsu.edu.cn/jenkins/",
            "https://mirror.iscas.ac.cn/jenkins/",
            "https://mirrors.xjtu.edu.cn/jenkins/"
        ];
        
        try {
            // 并发测量所有镜像站
            const results = await Promise.all(
                mirrors.map(url => measureSingleMirror(url))
            );
            
            // 过滤出成功的结果
            const successResults = results.filter(r => r.success);
            
            if (successResults.length === 0) {
                latencyElement.textContent = '所有镜像站超时';
                latencyElement.style.color = '#e53e3e';
                updateLastCheckTime();
                return;
            }
            
            // 找出延迟最小的
            const fastest = successResults.reduce((prev, current) => 
                current.latency < prev.latency ? current : prev
            );
            
            const latency = fastest.latency;
            
            // 根据延迟设置颜色
            if (latency < 300) {
                latencyElement.style.color = '#38a169'; // 绿色
            } else if (latency < 500) {
                latencyElement.style.color = '#dd6b20'; // 橙色
            } else {
                latencyElement.style.color = '#e53e3e'; // 红色
            }
            
            latencyElement.textContent = `${latency}ms`;
            
            // 在控制台输出详细信息
            console.log('镜像站延迟测试结果:');
            results.forEach(result => {
                if (result.success) {
                    console.log(`${result.url}: ${result.latency}ms`);
                } else {
                    console.log(`${result.url}: 超时`);
                }
            });
            console.log(`最快镜像站: ${fastest.url} (${fastest.latency}ms)`);
            
            updateLastCheckTime();
        } catch (error) {
            console.error('延迟测量失败:', error);
            latencyElement.textContent = '测量失败';
            latencyElement.style.color = '#e53e3e';
            updateLastCheckTime();
        }
    }
    
    // 初始化延迟测量
    const latencyElement = document.getElementById('latency');
    const lastCheckElement = document.getElementById('last-check');
    if (latencyElement && lastCheckElement) {
        // 首次加载时更新检查时间
        updateLastCheckTime();
        
        // 延迟500ms后开始测量
        setTimeout(measureLatency, 500);
        
        // 每5分钟重新测量一次
        setInterval(measureLatency, 300000);
    }
    
    // 下载按钮点击事件 - 使用代理路径
    const downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', function(e) {
            e.preventDefault();
            
            // 优先使用代理路径
            const proxyUrl = '/api/update-center.json';
            const directUrl = 'https://jenkins-plugins.foresai.com/update-center.json';
            
            // 尝试通过代理下载
            fetch(proxyUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('代理下载失败');
                    }
                    return response.blob();
                })
                .then(blob => {
                    const blobUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = blobUrl;
                    a.download = 'update-center.json';
                    document.body.appendChild(a);
                    a.click();
                    
                    setTimeout(() => {
                        window.URL.revokeObjectURL(blobUrl);
                        document.body.removeChild(a);
                    }, 100);
                })
                .catch(error => {
                    console.warn('代理下载失败，使用直链:', error);
                    
                    // 降级方案：直接使用原始链接
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = directUrl;
                    a.download = 'update-center.json';
                    a.target = '_blank';
                    
                    document.body.appendChild(a);
                    a.click();
                    
                    setTimeout(() => {
                        document.body.removeChild(a);
                    }, 100);
                });
        });
    }
    
    // 按钮悬停效果增强
    const buttons = document.querySelectorAll('.btn');
    buttons.forEach(button => {
        button.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        button.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // 添加页面加载动画
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
});
