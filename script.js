// 和风天气API配置
const API_KEY = 'a19494ae0d1e6e17e05c79b0c86b6185';
const BASE_URL = 'https://devapi.qweather.com/v7';

// 页面加载时获取天气
document.addEventListener('DOMContentLoaded', function() {
    searchWeather();
});

// 搜索天气函数
function searchWeather() {
    const cityInput = document.getElementById('cityInput');
    const city = cityInput.value.trim();
    
    if (!city) {
        showError('请输入城市名称');
        return;
    }
    
    showLoading();
    
    // 获取实时天气
    getCurrentWeather(city);
    // 获取3天预报
    getForecast(city);
}

// 获取实时天气
async function getCurrentWeather(city) {
    try {
        const response = await fetch(`${BASE_URL}/weather/now?location=${encodeURIComponent(city)}&key=${API_KEY}`);
        const data = await response.json();
        
        if (data.code === '200') {
            displayCurrentWeather(data.now, city);
        } else {
            showError('获取实时天气失败');
        }
    } catch (error) {
        showError('网络错误，请稍后重试');
    }
}

// 获取3天预报
async function getForecast(city) {
    try {
        const response = await fetch(`${BASE_URL}/weather/3d?location=${encodeURIComponent(city)}&key=${API_KEY}`);
        const data = await response.json();
        
        if (data.code === '200') {
            displayForecast(data.daily);
        } else {
            showError('获取天气预报失败');
        }
    } catch (error) {
        showError('网络错误，请稍后重试');
    }
}

// 显示实时天气
function displayCurrentWeather(weather, city) {
    document.getElementById('currentCity').textContent = city;
    document.getElementById('currentTemp').textContent = weather.temp;
    document.getElementById('currentDesc').textContent = weather.text;
}

// 显示天气预报
function displayForecast(forecast) {
    const forecastList = document.getElementById('forecastList');
    forecastList.innerHTML = '';
    
    forecast.forEach(day => {
        const date = new Date(day.fxDate);
        const dayName = getDayName(date.getDay());
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-date">${dayName}<br>${day.fxDate}</div>
            <div class="forecast-temp">${day.tempMax}°C / ${day.tempMin}°C</div>
            <div class="forecast-desc">${day.textDay}</div>
        `;
        
        forecastList.appendChild(forecastItem);
    });
}

// 获取星期名称
function getDayName(day) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[day];
}

// 显示加载状态
function showLoading() {
    const forecastList = document.getElementById('forecastList');
    forecastList.innerHTML = '<div class="loading">正在获取天气数据...</div>';
}

// 显示错误信息
function showError(message) {
    const forecastList = document.getElementById('forecastList');
    forecastList.innerHTML = `<div class="error">${message}</div>`;
}

// 回车键搜索
document.getElementById('cityInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchWeather();
    }
}); 