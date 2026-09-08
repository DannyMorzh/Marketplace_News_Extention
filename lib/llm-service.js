class LLMService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://openrouter.ai/api/v1';
  }

  async _fetchCompletion(systemPrompt, userPrompt, maxTokens = 2000) {
    // Список моделей для fallback, если первая вернёт 403
    const models = [
      'deepseek/deepseek-chat',
      'mistralai/mistral-small-3.1-24b-instruct',
      'meta-llama/llama-3.3-70b-instruct'
    ];

    let lastError = null;

    for (const model of models) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://marketplace-news-monitor.local',
            'X-Title': 'Marketplace News Monitor'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: maxTokens
          })
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.error) {
            throw new Error(data.error.message || JSON.stringify(data.error));
          }
          
          if (!data.choices || !data.choices[0]) {
            throw new Error('Некорректный ответ от API');
          }
          
          console.log(`[LLM] Успешно использована модель: ${model}`);
          return data.choices[0].message.content;
        }

        // Если 403 — пробуем следующую модель
        if (response.status === 403) {
          console.warn(`[LLM] Модель ${model} недоступна (403), пробую следующую...`);
          lastError = new Error(`Модель ${model} недоступна (403)`);
          continue;
        }

        // Другие ошибки
        const errorData = await response.json().catch(() => ({}));
        lastError = new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
        
        // Если ошибка не 403 — тоже пробуем следующую модель
        console.warn(`[LLM] Ошибка с моделью ${model}: ${lastError.message}`);
        
      } catch (error) {
        lastError = error;
        console.warn(`[LLM] Ошибка с моделью ${model}:`, error.message);
      }
    }

    throw lastError || new Error('Все модели недоступны');
  }

  async analyzeChanges(newsItems) {
    if (!newsItems || newsItems.length === 0) {
      return { overall_summary: 'Нет новостей для анализа', news_analysis: [] };
    }

    const systemPrompt = `Ты — системный аналитик маркетплейсов. Анализируй новости об изменениях на Wildberries, Ozon и Яндекс Маркет.

Для каждой новости определи:
1. category — категория (comission/logistics/api/content/legal/marketing/other)
2. impact — оценка влияния (1-5)
3. summary — краткое описание (1 предложение)
4. seller_action — что делать продавцу (1 предложение)

Верни ТОЛЬКО JSON, без markdown:
{
  "overall_summary": "общая сводка",
  "news_analysis": [
    {"title": "...", "category": "...", "impact": 0, "summary": "...", "seller_action": "..."}
  ]
}`;

    let userPrompt = 'Проанализируй:\n\n';
    newsItems.forEach((item, i) => {
      userPrompt += `[${i+1}] ${item.source} | ${item.date}\n${item.title}\n${item.content?.substring(0, 300) || ''}\n\n`;
    });

    const content = await this._fetchCompletion(systemPrompt, userPrompt, 2000);
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Не удалось извлечь JSON из ответа');
    
    return JSON.parse(jsonMatch[0]);
  }

  async generateTaskDraft(newsItem) {
    const systemPrompt = 'Ты — Project Manager. Создай черновик задачи.';
    const userPrompt = `Новость: ${newsItem.title}\nИсточник: ${newsItem.source}\nДата: ${newsItem.date}\n${newsItem.content}\n\nСоздай задачу: название, описание, критерии (3-5), приоритет.`;

    return await this._fetchCompletion(systemPrompt, userPrompt, 500);
  }
}
