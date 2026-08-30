class LLMService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://openrouter.ai/api/v1';
  }

  async _fetchCompletion(systemPrompt, userPrompt, maxTokens = 2000) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://marketplace-news-monitor.local',
        'X-Title': 'Marketplace News Monitor'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    
    if (!data.choices || !data.choices[0]) {
      throw new Error('Некорректный ответ от API');
    }
    
    return data.choices[0].message.content;
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