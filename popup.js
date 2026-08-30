// ==========================================
// popup.js — Marketplace News Monitor
// ==========================================

const state = {
  newsData: {},
  filteredNews: [],
  lastFetch: null,
  llmAnalysis: null
};

const elements = {
  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  sourceWB: document.getElementById('sourceWB'),
  sourceOzon: document.getElementById('sourceOzon'),
  sourceYandex: document.getElementById('sourceYandex'),
  applyFilterBtn: document.getElementById('applyFilterBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  resetBtn: document.getElementById('resetBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  newsList: document.getElementById('newsList'),
  summary: document.getElementById('summary'),
  summaryContent: document.getElementById('summaryContent'),
  loader: document.getElementById('loader'),
  emptyState: document.getElementById('emptyState')
};

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadStoredData();
  await restoreFilterState();
  
  elements.applyFilterBtn.addEventListener('click', applyFilter);
  elements.refreshBtn.addEventListener('click', refreshData);
  
  if (elements.analyzeBtn) {
    elements.analyzeBtn.addEventListener('click', runLLMAnalysis);
  }
  
  if (elements.resetBtn) {
    elements.resetBtn.addEventListener('click', resetAll);
  }
  
  if (elements.settingsBtn) {
    elements.settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
  
  elements.dateFrom.addEventListener('change', saveFilterState);
  elements.dateTo.addEventListener('change', saveFilterState);
  elements.sourceWB.addEventListener('change', saveFilterState);
  elements.sourceOzon.addEventListener('change', saveFilterState);
  elements.sourceYandex.addEventListener('change', saveFilterState);
  
  const savedNews = await chrome.storage.local.get('lastFilteredNews');
  if (savedNews.lastFilteredNews && savedNews.lastFilteredNews.length > 0) {
    state.filteredNews = savedNews.lastFilteredNews;
    renderNews(state.filteredNews);
    generateSummary(state.filteredNews);
  }
});

// ==========================================
// ЗАГРУЗКА ДАННЫХ
// ==========================================
async function loadStoredData() {
  const stored = await chrome.storage.local.get(['newsData', 'lastFetch']);
  
  if (stored.newsData) {
    state.newsData = stored.newsData;
    state.lastFetch = stored.lastFetch;
  }
}

// ==========================================
// СОХРАНЕНИЕ И ВОССТАНОВЛЕНИЕ ФИЛЬТРОВ
// ==========================================
async function saveFilterState() {
  const filterState = {
    dateFrom: elements.dateFrom.value,
    dateTo: elements.dateTo.value,
    sourceWB: elements.sourceWB.checked,
    sourceOzon: elements.sourceOzon.checked,
    sourceYandex: elements.sourceYandex.checked
  };
  await chrome.storage.local.set({ filterState });
}

async function restoreFilterState() {
  const saved = await chrome.storage.local.get('filterState');
  
  if (saved.filterState) {
    elements.dateFrom.value = saved.filterState.dateFrom || '';
    elements.dateTo.value = saved.filterState.dateTo || '';
    elements.sourceWB.checked = saved.filterState.sourceWB !== false;
    elements.sourceOzon.checked = saved.filterState.sourceOzon !== false;
    elements.sourceYandex.checked = saved.filterState.sourceYandex !== false;
  } else {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    elements.dateTo.value = now.toISOString().split('T')[0];
    elements.dateFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
    
    elements.sourceWB.checked = true;
    elements.sourceOzon.checked = true;
    elements.sourceYandex.checked = true;
    
    saveFilterState();
  }
}

// ==========================================
// СБРОС ВСЕХ ФИЛЬТРОВ
// ==========================================
async function resetAll() {
  const today = new Date().toISOString().split('T')[0];
  elements.dateFrom.value = today;
  elements.dateTo.value = today;
  
  elements.sourceWB.checked = false;
  elements.sourceOzon.checked = false;
  elements.sourceYandex.checked = false;
  
  state.filteredNews = [];
  state.llmAnalysis = null;
  elements.newsList.innerHTML = `
    <div class="empty-state">
      <span class="empty-state__icon">📰</span>
      <p class="empty-state__text">Нажмите «Применить фильтр» для загрузки новостей</p>
    </div>
  `;
  elements.summary.style.display = 'none';
  
  await chrome.storage.local.set({ lastFilteredNews: [] });
  await saveFilterState();
  
  showToast('🔄 Фильтры сброшены');
}

// ==========================================
// ПРИМЕНЕНИЕ ФИЛЬТРА
// ==========================================
async function applyFilter() {
  const dateFromVal = elements.dateFrom.value;
  const dateToVal = elements.dateTo.value;
  
  if (dateFromVal && dateToVal) {
    const fromDate = new Date(dateFromVal);
    const toDate = new Date(dateToVal);
    
    if (fromDate > toDate) {
      showToast('❌ Начальная дата не может быть больше конечной');
      return;
    }
  }
  
  let dateFrom = null;
  let dateTo = null;
  
  if (dateFromVal) {
    dateFrom = new Date(dateFromVal);
    dateFrom.setHours(0, 0, 0, 0);
  }
  
  if (dateToVal) {
    dateTo = new Date(dateToVal);
    dateTo.setHours(23, 59, 59, 999);
  }
  
  const selectedSources = [];
  if (elements.sourceWB.checked) selectedSources.push('wildberries');
  if (elements.sourceOzon.checked) selectedSources.push('ozon');
  if (elements.sourceYandex.checked) selectedSources.push('yandex');
  
  let allNews = [];
  
  selectedSources.forEach(source => {
    const sourceData = state.newsData[source];
    if (sourceData && Array.isArray(sourceData)) {
      sourceData.forEach(item => {
        allNews.push({
          ...item,
          sourceKey: source
        });
      });
    }
  });
  
  if (dateFrom || dateTo) {
    allNews = allNews.filter(item => {
      const itemDate = parseDate(item.date);
      if (!itemDate) return true;
      if (dateFrom && itemDate < dateFrom) return false;
      if (dateTo && itemDate > dateTo) return false;
      return true;
    });
  }
  
  const sourceOrder = { wildberries: 0, ozon: 1, yandex: 2 };
  
  allNews.sort((a, b) => {
    const sourceA = sourceOrder[a.sourceKey] ?? 99;
    const sourceB = sourceOrder[b.sourceKey] ?? 99;
    
    if (sourceA !== sourceB) return sourceA - sourceB;
    
    const dateA = parseDate(a.date) || new Date(0);
    const dateB = parseDate(b.date) || new Date(0);
    return dateB - dateA;
  });
  
  state.filteredNews = allNews;
  state.llmAnalysis = null;
  
  await chrome.storage.local.set({ lastFilteredNews: allNews });
  
  console.log(`Отфильтровано ${allNews.length} новостей`);
  
  renderNews(allNews);
  generateSummary(allNews);
  
  showToast(`✅ Найдено ${allNews.length} новостей`);
}

// ==========================================
// РЕНДЕР НОВОСТЕЙ
// ==========================================
function renderNews(news) {
  elements.newsList.innerHTML = '';
  
  if (news.length === 0) {
    elements.newsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon">📭</span>
        <p class="empty-state__text">Новостей за выбранный период не найдено</p>
      </div>
    `;
    return;
  }
  
  news.forEach((item, index) => {
    const sourceClass = getSourceClass(item.sourceKey || item.source);
    
    let badges = '';
    if (item.type) {
      badges += `<span class="badge badge--type">${escapeHtml(item.type)}</span>`;
    }
    if (item.critical) {
      badges += `<span class="badge badge--critical">⚠️ Критичное</span>`;
    }
    if (item.scopes && item.scopes.length > 0) {
      item.scopes.forEach(scope => {
        badges += `<span class="badge badge--scope">${escapeHtml(scope)}</span>`;
      });
    }
    
    const card = document.createElement('div');
    card.className = `news-card news-card--${sourceClass}`;
    card.innerHTML = `
      <div class="news-card__header">
        <div class="news-card__title">${escapeHtml(item.title)}</div>
        <span class="news-card__source news-card__source--${sourceClass}">${escapeHtml(item.source)}</span>
      </div>
      <div class="news-card__meta">
        <span class="news-card__date">📅 ${escapeHtml(item.date)}</span>
        ${badges ? `<div class="news-card__badges">${badges}</div>` : ''}
      </div>
      ${item.content ? `<div class="news-card__content">${escapeHtml(truncateText(item.content, 300))}</div>` : ''}
      <div class="news-card__actions">
        <button class="btn btn--small copy-btn" data-index="${index}" title="Копировать задачу">
          📋 Задача
        </button>
        <button class="btn btn--small expand-btn" data-index="${index}" title="Показать полностью">
          🔍 Подробнее
        </button>
      </div>
    `;
    
    elements.newsList.appendChild(card);
  });
  
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      copyTaskDraft(state.filteredNews[index]);
    });
  });
  
  document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      showFullContent(state.filteredNews[index]);
    });
  });
}

// ==========================================
// СВОДКА
// ==========================================
function generateSummary(news) {
  if (news.length === 0) {
    elements.summary.style.display = 'none';
    return;
  }
  
  elements.summary.style.display = 'block';
  
  const sources = [...new Set(news.map(n => n.source))];
  const latestDate = news[0]?.date || 'N/A';
  
  let summaryHtml = `
    <p>Найдено <strong>${news.length}</strong> новостей от источников: ${sources.join(', ')}</p>
    <p>Последнее обновление: ${latestDate}</p>
  `;
  
  sources.forEach(source => {
    const count = news.filter(n => n.source === source).length;
    summaryHtml += `<p>• ${source}: ${count} новостей</p>`;
  });
  
  elements.summaryContent.innerHTML = summaryHtml;
}

// ==========================================
// LLM-АНАЛИЗ
// ==========================================
async function runLLMAnalysis() {
  if (state.filteredNews.length === 0) {
    showToast('⚠️ Сначала примените фильтр');
    return;
  }
  
  const btn = elements.analyzeBtn;
  if (!btn) return;
  
  btn.disabled = true;
  btn.textContent = '⏳ Анализирую...';
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeWithLLM',
      newsItems: state.filteredNews
    });
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    state.llmAnalysis = response;
    renderLLMAnalysis(response);
    
    btn.textContent = '✅ Анализ готов';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '🤖 Анализировать с LLM';
    }, 2000);
  } catch (error) {
    showToast('❌ ' + error.message);
    btn.disabled = false;
    btn.textContent = '🤖 Анализировать с LLM';
  }
}

function renderLLMAnalysis(analysis) {
  elements.summary.style.display = 'block';
  elements.summaryContent.innerHTML = `
    <p style="font-weight: 500; margin-bottom: 8px;">🧠 Анализ:</p>
    <p>${analysis.overall_summary || 'Анализ выполнен'}</p>
  `;
  
  const cards = document.querySelectorAll('.news-card');
  analysis.news_analysis?.forEach((item, index) => {
    if (cards[index]) {
      const impactBadge = document.createElement('span');
      impactBadge.style.cssText = `
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        margin-left: 8px;
        background: ${getImpactColor(item.impact)};
        color: white;
      `;
      impactBadge.textContent = `Impact: ${item.impact}/5`;
      
      const categoryBadge = document.createElement('span');
      categoryBadge.style.cssText = `
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        margin-left: 4px;
        background: #e5e7eb;
      `;
      categoryBadge.textContent = getCategoryName(item.category);
      
      const header = cards[index].querySelector('.news-card__header');
      if (header) {
        header.appendChild(impactBadge);
        header.appendChild(categoryBadge);
      }
      
      if (item.seller_action) {
        const action = document.createElement('div');
        action.className = 'seller-action';
        action.textContent = '💡 ' + item.seller_action;
        const contentEl = cards[index].querySelector('.news-card__content');
        if (contentEl) {
          contentEl.after(action);
        }
      }
    }
  });
}

// ==========================================
// КОПИРОВАНИЕ ЗАДАЧИ
// ==========================================
async function copyTaskDraft(newsItem) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'generateTask',
      newsItem: newsItem
    });
    
    if (response && !response.error && typeof response === 'string') {
      await navigator.clipboard.writeText(response);
      showToast('✅ Задача от LLM скопирована');
      return;
    }
  } catch (e) {
    // fallback
  }
  
  const taskDraft = `# Задача: ${newsItem.title}
**Источник:** ${newsItem.source}
**Дата:** ${newsItem.date}
**Тип:** ${newsItem.type || 'Не указан'}
**Критичность:** ${newsItem.critical ? 'Критичное' : 'Обычное'}
**Разделы:** ${(newsItem.scopes || []).join(', ') || 'Не указаны'}

## Описание
${newsItem.content || 'Требуется анализ'}

${newsItem.links && newsItem.links.length > 0 ? `
## Ссылки
${newsItem.links.map(l => `- ${l.text}: ${l.url}`).join('\n')}
` : ''}

## Действия
- [ ] Проанализировать влияние на текущие проекты
- [ ] Внести изменения в документацию
- [ ] Уведомить заинтересованные стороны`;
  
  try {
    await navigator.clipboard.writeText(taskDraft);
    showToast('✅ Задача скопирована');
  } catch (e) {
    showToast('❌ Не удалось скопировать');
  }
}

// ==========================================
// ПОКАЗАТЬ ПОЛНОСТЬЮ
// ==========================================
function showFullContent(newsItem) {
  const oldModal = document.getElementById('newsModal');
  if (oldModal) oldModal.remove();
  
  const modal = document.createElement('div');
  modal.id = 'newsModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 440px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    font-size: 14px;
    line-height: 1.6;
  `;
  
  const scopes = (newsItem.scopes || []).join(', ') || 'Не указаны';
  
  content.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
      <h3 style="margin: 0; font-size: 16px; flex: 1; padding-right: 16px;">${escapeHtml(newsItem.title)}</h3>
      <button id="closeModalBtn" style="
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #6b7280;
        padding: 0;
        line-height: 1;
      ">✕</button>
    </div>
    
    <div style="margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
      <span style="background: #f3f4f6; padding: 4px 10px; border-radius: 12px; font-size: 13px;">📅 ${escapeHtml(newsItem.date)}</span>
      <span style="background: #f3f4f6; padding: 4px 10px; border-radius: 12px; font-size: 13px;">🏷️ ${escapeHtml(newsItem.source)}</span>
      ${newsItem.type ? `<span style="background: #dcfce7; color: #166534; padding: 4px 10px; border-radius: 12px; font-size: 13px;">${escapeHtml(newsItem.type)}</span>` : ''}
      ${newsItem.critical ? '<span style="background: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 12px; font-size: 13px;">⚠️ Критичное</span>' : ''}
    </div>
    
    ${newsItem.scopes?.length ? `<p style="margin-bottom: 12px; font-size: 13px; color: #6b7280;">📂 Разделы: ${escapeHtml(scopes)}</p>` : ''}
    
    <div style="
      background: #f9fafb;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      max-height: 300px;
      overflow-y: auto;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    ">
      ${newsItem.contentHtml || escapeHtml(newsItem.content || 'Нет описания')}
    </div>
    
    <button id="modalCopyBtn" style="
      background: #2563eb;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      width: 100%;
    ">📋 Скопировать задачу</button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  
  document.getElementById('closeModalBtn').addEventListener('click', () => modal.remove());
  document.getElementById('modalCopyBtn').addEventListener('click', () => {
    copyTaskDraft(newsItem);
  });
  
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// ==========================================
// ОБНОВЛЕНИЕ ДАННЫХ
// ==========================================
async function refreshData() {
  elements.loader.style.display = 'block';
  
  try {
    await chrome.runtime.sendMessage({ action: 'fetchNews' });
    
    setTimeout(async () => {
      await loadStoredData();
      applyFilter();
      elements.loader.style.display = 'none';
      showToast('✅ Данные обновлены');
    }, 5000);
  } catch (error) {
    elements.loader.style.display = 'none';
    showToast('❌ Ошибка при обновлении данных');
  }
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  const ddmmyyyy = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  }
  
  const yyyymmdd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (yyyymmdd) {
    return new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
  }
  
  const mmddyyyy = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (mmddyyyy) {
    return new Date(parseInt(mmddyyyy[3]), parseInt(mmddyyyy[1]) - 1, parseInt(mmddyyyy[2]));
  }
  
  return null;
}

function getSourceClass(sourceKey) {
  const map = { wildberries: 'wb', ozon: 'ozon', yandex: 'yandex' };
  return map[sourceKey] || 'wb';
}

function getImpactColor(impact) {
  if (impact >= 5) return '#EF4444';
  if (impact >= 3) return '#F59E0B';
  return '#6B7280';
}

function getCategoryName(category) {
  const names = {
    comission: '💰 Тарифы', logistics: '🚚 Логистика', api: '🔌 API',
    content: '📝 Контент', legal: '⚖️ Юридическое', marketing: '📢 Маркетинг',
    other: '📌 Другое'
  };
  return names[category] || category;
}

function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: #1f2937;
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    z-index: 1000;
    transition: opacity 0.3s;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}