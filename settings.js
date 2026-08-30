// Загрузка сохранённых настроек
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.local.get([
    'openaiApiKey',
    'autoAnalyze',
    'newsData',
    'lastFetch',
    'lastAnalysisDate',
    'criticalNews'
  ]);
  
  if (settings.openaiApiKey) {
    document.getElementById('apiKey').value = settings.openaiApiKey;
  }
  
  document.getElementById('autoAnalyze').checked = settings.autoAnalyze !== false;
  
  // Статистика
  updateStats(settings);
  
  // Обработчики
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('testConnection').addEventListener('click', testConnection);
});

function updateStats(settings) {
  // Всего новостей
  let total = 0;
  if (settings.newsData) {
    for (const source of Object.values(settings.newsData)) {
      if (Array.isArray(source)) total += source.length;
    }
  }
  document.getElementById('totalNews').textContent = total;
  
  // Критические изменения
  const critical = settings.criticalNews?.length || 0;
  document.getElementById('criticalNews').textContent = critical;
  
  // Последний сбор
  document.getElementById('lastFetch').textContent = 
    settings.lastFetch ? formatDate(settings.lastFetch) : 'Никогда';
  
  // Последний анализ
  document.getElementById('lastAnalysis').textContent = 
    settings.lastAnalysisDate ? formatDate(settings.lastAnalysisDate) : 'Никогда';
}

async function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    showStatus('Введите API ключ', 'error');
    return;
  }
  
  await chrome.storage.local.set({ openaiApiKey: apiKey });
  showStatus('✅ API ключ сохранён', 'success');
}

async function saveSettings() {
  const autoAnalyze = document.getElementById('autoAnalyze').checked;
  await chrome.storage.local.set({ autoAnalyze });
  showStatus('✅ Настройки сохранены', 'success');
}

async function testConnection() {
  const settings = await chrome.storage.local.get(['testApiKey', 'openaiApiKey']);
  const apiKey = settings.testApiKey || settings.openaiApiKey;
  
  if (!apiKey) {
    showStatus('❌ Сначала сохраните API ключ', 'error');
    return;
  }
  
  showStatus('⏳ Проверяю подключение к OpenRouter...', 'info');
  
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      showStatus(`✅ Подключено! Кредитов: $${data.data?.credits || 'N/A'}`, 'success');
    } else {
      const error = await response.json().catch(() => ({}));
      showStatus(`❌ Ошибка: ${error.error?.message || 'Неверный ключ'}`, 'error');
    }
  } catch (error) {
    showStatus('❌ Ошибка сети: ' + error.message, 'error');
  }
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  
  if (type === 'success') {
    setTimeout(() => {
      status.innerHTML = '';
    }, 3000);
  }
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHours < 1) return 'Меньше часа назад';
  if (diffHours < 24) return `${diffHours} ч. назад`;
  
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}