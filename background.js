// ==========================================
// background.js — Marketplace News Monitor
// ==========================================

try {
  importScripts('lib/llm-service.js');
} catch (e) {
  console.error('Не удалось загрузить llm-service.js:', e);
}

const SOURCES = {
  wildberries: {
    name: 'Wildberries',
    url: 'https://dev.wildberries.ru/release-notes',
    useTab: true
  },
  ozon: {
    name: 'Ozon',
    url: 'https://docs.ozon.ru/api/seller/#tag/News',
    useTab: true
  },
  yandex: {
    name: 'Яндекс Маркет',
    url: 'https://yandex.ru/dev/market/partner-api/doc/ru/changelog/all',
    useTab: false
  }
};

// ==========================================
// ЗАПУСК
// ==========================================
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Расширение установлено. Первый сбор новостей...');
  await fetchAllSources();
});

chrome.alarms.create('fetchNews', { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fetchNews') {
    await fetchAllSources();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchNews') {
    fetchAllSources()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  
  if (request.action === 'analyzeWithLLM') {
    analyzeNewsWithLLM(request.newsItems)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  
  if (request.action === 'generateTask') {
    generateTaskDraft(request.newsItem)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

// ==========================================
// СБОР ДАННЫХ
// ==========================================
async function fetchAllSources() {
  console.log('Начинаю сбор новостей...');
  const results = {};
  
  for (const [key, source] of Object.entries(SOURCES)) {
    try {
      console.log(`Загружаю: ${source.name}`);
      
      let html;
      
      if (source.useTab) {
        html = await fetchViaTab(source.url, key);
      } else {
        const response = await fetch(source.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru-RU,ru;q=0.9'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        html = await response.text();
      }
      
      console.log(`${source.name}: загружено ${html.length} символов`);
      
      let parsed;
      if (key === 'wildberries') {
        parsed = parseWildberries(html);
      } else if (key === 'ozon') {
        parsed = parseOzon(html);
      } else if (key === 'yandex') {
        parsed = parseYandex(html);
      }
      
      results[key] = parsed;
      
      console.log(`${source.name}: найдено ${parsed.length} новостей`);
    } catch (error) {
      console.error(`Ошибка при парсинге ${source.name}:`, error.message);
      results[key] = [];
    }
  }
  
  await chrome.storage.local.set({
    newsData: results,
    lastFetch: new Date().toISOString()
  });
  
  console.log('Сбор завершён. Итоги:', {
    wildberries: results.wildberries?.length || 0,
    ozon: results.ozon?.length || 0,
    yandex: results.yandex?.length || 0
  });
}

// ==========================================
// ЗАГРУЗКА ЧЕРЕЗ ФОНОВУЮ ВКЛАДКУ
// ==========================================
async function fetchViaTab(url, sourceKey) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ 
      url: url,
      active: false
    }, async (tab) => {
      await new Promise(r => setTimeout(r, 5000));
      
      try {
        if (sourceKey === 'ozon') {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const newsLink = document.querySelector('[data-item-id="tag/News"]');
              if (newsLink) {
                newsLink.click();
                
                let waited = 0;
                while (waited < 60) {
                  const sections = document.querySelectorAll('[data-section-id]');
                  for (const section of sections) {
                    const id = section.getAttribute('data-section-id');
                    if (id === 'section/27-avgusta-2026' && section.querySelector('table')) {
                      return document.documentElement.outerHTML;
                    }
                  }
                  const start = Date.now();
                  while (Date.now() - start < 1000) {}
                  waited++;
                }
              }
              return document.documentElement.outerHTML;
            }
          });
          
          const html = results[0]?.result || '';
          chrome.tabs.remove(tab.id);
          resolve(html);
        } else {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
          });
          
          const html = results[0]?.result || '';
          chrome.tabs.remove(tab.id);
          resolve(html);
        }
      } catch (e) {
        chrome.tabs.remove(tab.id);
        reject(e);
      }
    });
  });
}

// ==========================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: парсинг даты из ДД.ММ.ГГГГ
// ==========================================
function parseDateFromFormat(dateStr) {
  if (!dateStr) return null;
  
  const match = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (match) {
    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
  }
  
  return null;
}

// ==========================================
// ИЗВЛЕЧЕНИЕ ССЫЛОК ИЗ HTML
// ==========================================
function extractLinks(html) {
  const links = [];
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const text = cleanHtml(match[2]);
    
    if (url && text) {
      links.push({ url, text });
    }
  }
  
  return links;
}

// ==========================================
// САНИТАЙЗЕР: оставляет ссылки, убирает остальные теги
// ==========================================
function sanitizeHtml(html) {
  if (!html) return '';
  
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?!\/?a\b)[^>]*>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/\s+/g, ' ')
    .trim();
  
  return cleaned;
}

// ==========================================
// ПАРСЕР WILDBERRIES (устойчивый к динамическим классам)
// ==========================================
function parseWildberries(html) {
  const news = [];
  
  const noteRegex = /<div[^>]*id="note-\d+"[^>]*>([\s\S]*?)(?=<div[^>]*id="note-\d+"|$)/gi;
  const blocks = html.match(noteRegex) || [];
  
  console.log(`[WB] Найдено блоков: ${blocks.length}`);
  
  blocks.forEach(block => {
    const typeMatch = block.match(/data-name="Text">(Новое|Изменение|Исправление|Уведомление)<\/span>/i);
    const newsType = typeMatch ? typeMatch[1] : '';
    
    const dateMatch = block.match(/(\d{2}\.\d{2}\.\d{4})/);
    const date = dateMatch ? dateMatch[1] : 'Дата не указана';
    
    const isCritical = block.includes('Критичное изменение');
    
    const titleMatch = block.match(/data-name="Text">([^<]{10,300})<\/span>/g);
    let title = '';
    
    if (titleMatch) {
      let longest = '';
      titleMatch.forEach(t => {
        const text = t.replace(/data-name="Text">|<\/span>/g, '');
        if (text.length > longest.length && text.length < 300) {
          longest = text;
        }
      });
      title = longest;
    }
    
    const contentMatch = block.match(/<div[^>]*class="[^"]*_wrapper[^"]*"[^>]*>([\s\S]*?)(?=<\/div><\/div><\/div>|<\/div><\/div>|$)/i);
    let content = '';
    
    if (contentMatch) {
      content = cleanHtml(contentMatch[1]);
    } else {
      const pMatches = block.match(/<p>([\s\S]*?)<\/p>/gi) || [];
      const pTexts = pMatches.map(p => cleanHtml(p));
      content = pTexts.join(' ');
    }
    
    const scopes = [];
    const scopeRegex = /<span>([^<]{2,60})<\/span>/g;
    let scopeMatch;
    
    while ((scopeMatch = scopeRegex.exec(block)) !== null) {
      const scope = scopeMatch[1].trim();
      if (scope && !['Новое', 'Изменение', 'Исправление', 'Уведомление'].includes(scope) && scope.length < 50) {
        scopes.push(scope);
      }
    }
    
    if (title) {
      const links = extractLinks(block);
      const contentHtml = sanitizeHtml(contentMatch ? contentMatch[1] : block);
      
      news.push({
        title: title,
        date: date,
        type: newsType,
        critical: isCritical,
        scopes: scopes.slice(0, 5),
        content: content,
        contentHtml: contentHtml,
        links: links,
        source: 'Wildberries'
      });
    }
  });
  
  console.log(`[WB] Распарсено ${news.length} новостей`);
  return news;
}

// ==========================================
// ПАРСЕР OZON (сгруппировано по датам, с сортировкой)
// ==========================================
function parseOzon(html) {
  const news = [];
  
  const sectionRegex = /<div[^>]*data-section-id="section\/(\d{1,2}-[a-z]+-\d{4})"[^>]*>([\s\S]*?)(?=<div[^>]*data-section-id="section\/|$)/gi;
  const allSections = [];
  let match;
  
  while ((match = sectionRegex.exec(html)) !== null) {
    const slug = match[1];
    const sectionContent = match[2];
    const date = parseOzonDate(slug, '');
    const dateObj = parseDateFromFormat(date) || new Date(0);
    
    allSections.push({
      slug,
      date,
      dateObj,
      sectionContent
    });
  }
  
  console.log(`[Ozon] Найдено секций: ${allSections.length}`);
  
  allSections.sort((a, b) => b.dateObj - a.dateObj);
  
  allSections.forEach(section => {
    const changes = [];
    const tableRegex = /<table>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    
    while ((tableMatch = tableRegex.exec(section.sectionContent)) !== null) {
      const tableHtml = tableMatch[1];
      const rows = tableHtml.split(/<tr>/gi);
      
      rows.forEach(row => {
        if (!row.includes('<td>')) return;
        
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let cellMatch;
        
        while ((cellMatch = cellRegex.exec(row)) !== null) {
          cells.push(cellMatch[1]);
        }
        
        if (cells.length >= 2) {
          const methodRaw = cleanHtml(cells[0]);
          const change = cleanHtml(cells[1]);
          
          if (change.length < 5) return;
          if (methodRaw === 'Метод' || methodRaw === 'Изменение') return;
          
          const method = methodRaw.length >= 3 ? methodRaw : 'Документация';
          
          changes.push({ method, change });
        }
      });
    }
    
    if (changes.length > 0) {
      const allText = changes.map(c => c.change).join(' ');
      
      let changeType = 'Изменение';
      if (allText.includes('устаревает') || allText.includes('отключён')) changeType = 'Устаревание';
      else if (allText.includes('Удалили') || allText.includes('удалили')) changeType = 'Удаление';
      else if (allText.includes('добавили') || allText.includes('Добавили')) changeType = 'Новое';
      
      const isCritical = allText.includes('отключён') || 
                         allText.includes('обязательным') ||
                         allText.includes('устаревает');
      
      const scopes = [...new Set(changes.map(c => c.method.split('/')[1]).filter(Boolean))];
      
      const summary = changes
        .slice(0, 2)
        .map(c => `${c.method.split('/').pop()}: ${c.change.substring(0, 60)}`)
        .join('; ');
      
      const content = changes
        .map(c => `• ${c.method}: ${c.change}`)
        .join('\n');
      
      const links = extractLinks(section.sectionContent);
      
      news.push({
        title: summary.length > 150 ? summary.substring(0, 147) + '...' : summary,
        date: section.date,
        type: changeType,
        critical: isCritical,
        scopes: scopes.slice(0, 5),
        content: content,
        contentHtml: sanitizeHtml(section.sectionContent),
        links: links,
        source: 'Ozon'
      });
    }
  });
  
  console.log(`[Ozon] Распарсено ${news.length} новостей`);
  return news.slice(0, 50);
}

// ==========================================
// ПАРСЕР OZON — ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДАТЫ
// ==========================================
function parseOzonDate(slug, text) {
  const months = {
    'yanvarya': '01', 'fevralya': '02', 'marta': '03',
    'aprelya': '04', 'maya': '05', 'iyunya': '06',
    'iyulya': '07', 'avgusta': '08', 'sentyabrya': '09',
    'oktyabrya': '10', 'noyabrya': '11', 'dekabrya': '12'
  };
  
  const slugMatch = slug.match(/(\d{1,2})-([a-z]+)-(\d{4})/i);
  if (slugMatch) {
    const day = slugMatch[1].padStart(2, '0');
    const month = months[slugMatch[2].toLowerCase()] || '01';
    const year = slugMatch[3];
    return `${day}.${month}.${year}`;
  }
  
  const textMatch = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (textMatch) {
    const day = textMatch[1].padStart(2, '0');
    const month = months[textMatch[2].toLowerCase()] || '01';
    const year = textMatch[3];
    return `${day}.${month}.${year}`;
  }
  
  return text || 'Дата не указана';
}

// ==========================================
// ПАРСЕР YANDEX MARKET
// ==========================================
function parseYandex(html) {
  const news = [];
  
  const headingRegex = /<h3[^>]*id="(\d{2})-(\d{2})-(\d{2})"[^>]*>.*?<\/a>([\s\S]*?)<\/h3>/gi;
  let match;
  
  while ((match = headingRegex.exec(html)) !== null) {
    const day = match[1];
    const month = match[2];
    const yearShort = match[3];
    const year = `20${yearShort}`;
    
    const dateText = cleanHtml(match[4]);
    
    if (dateText.length > 30 || dateText.length === 0) continue;
    
    const date = parseYandexDate(dateText, year);
    const headingPos = match.index;
    
    const afterHeading = html.substring(headingPos);
    const tableMatch = afterHeading.match(/<table>([\s\S]*?)<\/table>/i);
    
    if (!tableMatch) continue;
    
    const tableHtml = tableMatch[1];
    const changes = [];
    
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isHeader = true;
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowContent = rowMatch[1];
      
      if (isHeader && (rowContent.includes('<strong>Методы') || rowContent.includes('<th>'))) {
        isHeader = false;
        continue;
      }
      isHeader = false;
      
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells = [];
      let cellMatch;
      
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        cells.push(cellMatch[1]);
      }
      
      if (cells.length >= 2) {
        const method = cleanHtml(cells[0]);
        const change = cleanHtml(cells[1]);
        
        if (method.length < 3 || change.length < 5) continue;
        
        changes.push({ method, change });
      }
    }
    
    if (changes.length > 0) {
      const allText = changes.map(c => c.change).join(' ');
      
      let changeType = 'Изменение';
      if (allText.includes('устаревш') || allText.includes('Устаревш')) changeType = 'Устаревание';
      else if (allText.includes('Удалили') || allText.includes('удалили')) changeType = 'Удаление';
      else if (allText.includes('Добавили') || allText.includes('добавили')) changeType = 'Новое';
      
      const isCritical = allText.includes('устаревш') || 
                         allText.includes('Устаревш') ||
                         allText.includes('отключён') ||
                         allText.includes('отключен');
      
      const scopes = [...new Set(changes.map(c => {
        const parts = c.method.split('/');
        return parts[1] || parts[0] || 'API';
      }))].filter(Boolean);
      
      const summary = changes
        .slice(0, 2)
        .map(c => `${c.method.substring(0, 40)}: ${c.change.substring(0, 60)}`)
        .join('; ');
      
      const content = changes
        .map(c => `• ${c.method}: ${c.change}`)
        .join('\n');
      
      const links = extractLinks(tableHtml);
      
      news.push({
        title: summary.length > 150 ? summary.substring(0, 147) + '...' : summary,
        date: date,
        type: changeType,
        critical: isCritical,
        scopes: scopes.slice(0, 5),
        content: content,
        contentHtml: sanitizeHtml(tableHtml),
        links: links,
        source: 'Яндекс Маркет'
      });
    }
  }
  
  console.log(`[Yandex] Распарсено ${news.length} новостей`);
  return news.slice(0, 50);
}

// ==========================================
// ПАРСЕР YANDEX — ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДАТЫ
// ==========================================
function parseYandexDate(dateText, yearFallback) {
  if (!dateText || dateText === 'Дата не указана') return 'Дата не указана';
  
  const months = {
    'января': '01', 'февраля': '02', 'марта': '03',
    'апреля': '04', 'мая': '05', 'июня': '06',
    'июля': '07', 'августа': '08', 'сентября': '09',
    'октября': '10', 'ноября': '11', 'декабря': '12'
  };
  
  const parts = dateText.trim().split(/\s+/);
  
  if (parts.length >= 2) {
    const day = parts[0].padStart(2, '0');
    const monthName = parts[1].toLowerCase();
    const month = months[monthName] || '01';
    const year = yearFallback || new Date().getFullYear();
    return `${day}.${month}.${year}`;
  }
  
  return 'Дата не указана';
}

// ==========================================
// ОЧИСТКА HTML
// ==========================================
function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================
// LLM-АНАЛИЗ
// ==========================================
async function getApiKey() {
  const settings = await chrome.storage.local.get(['testApiKey', 'openaiApiKey']);
  return settings.testApiKey || settings.openaiApiKey || null;
}

async function analyzeNewsWithLLM(newsItems) {
  const apiKey = await getApiKey();
  
  if (!apiKey) {
    throw new Error('API ключ не найден. Откройте настройки расширения и сохраните ключ.');
  }
  
  if (typeof LLMService === 'undefined') {
    throw new Error('LLM-сервис не загружен.');
  }
  
  const llm = new LLMService(apiKey);
  return await llm.analyzeChanges(newsItems);
}

async function generateTaskDraft(newsItem) {
  const apiKey = await getApiKey();
  
  if (!apiKey) {
    throw new Error('API ключ не найден.');
  }
  
  if (typeof LLMService === 'undefined') {
    throw new Error('LLM-сервис не загружен.');
  }
  
  const llm = new LLMService(apiKey);
  return await llm.generateTaskDraft(newsItem);
}