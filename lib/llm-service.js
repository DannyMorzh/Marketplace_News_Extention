// ==========================================
// llm-service.js — Google Gemini API
// ==========================================

class LLMService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async _fetchCompletion(systemPrompt, userPrompt, maxTokens = 2000) {
    // Объединяем system и user в один промпт
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    
    const response = await fetch(
      `${this.baseUrl}/models/gemini-3.6-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: fullPrompt }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: maxTokens
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    
    if (!data.candidates || !data.candidates[0]) {
      throw new Error('Некорректный ответ от API');
    }
    
    const content = data.candidates[0].content;
    if (!content || !content.parts || !content.parts[0]) {
      throw new Error('Пустой ответ от API');
    }
    
    return content.parts[0].text;
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
