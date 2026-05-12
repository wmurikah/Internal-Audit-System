// 05_AIService.gs - AI API Integration (OpenAI, Anthropic, Google AI), Insights, Validation

const AI_CONFIG = {
  PROVIDERS: {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    GOOGLE_AI: 'google_ai'
  },

  MODELS: {
    OPENAI: {
      GPT4: 'gpt-4-turbo-preview',
      GPT35: 'gpt-3.5-turbo'
    },
    ANTHROPIC: {
      CLAUDE3: 'claude-3-sonnet-20240229',
      CLAUDE35: 'claude-3-5-sonnet-20241022'
    },
    GOOGLE_AI: {
      GEMINI: 'gemini-pro'
    }
  },

  MAX_TOKENS: 2000,
  TEMPERATURE: 0.3,  // Lower for more consistent outputs
  TIMEOUT_MS: 30000
};

function getAIApiKey(provider) {
  const props = PropertiesService.getScriptProperties();
  const keyName = 'AI_API_KEY_' + provider.toUpperCase();
  return props.getProperty(keyName);
}

/**
 * Set AI API key (requires SUPER_ADMIN)
 */
function setAIApiKey(provider, apiKey, user) {
  if (!user || user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied: Only Super Admin can configure AI API keys');
  }

  const props = PropertiesService.getScriptProperties();
  const keyName = 'AI_API_KEY_' + provider.toUpperCase();

  // Validate key format
  if (!validateApiKeyFormat(provider, apiKey)) {
    throw new Error('Invalid API key format for ' + provider);
  }

  props.setProperty(keyName, apiKey);

  // Update config to track enabled provider
  tursoSetConfig('AI_PROVIDER_' + provider.toUpperCase() + '_ENABLED', 'true', 'GLOBAL');

  logAuditEvent('SET_AI_KEY', 'CONFIG', provider, null, { provider: provider }, user.user_id, user.email);

  return { success: true, message: 'API key configured successfully' };
}

/**
 * Remove AI API key
 */
function removeAIApiKey(provider, user) {
  if (!user || user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied: Only Super Admin can remove AI API keys');
  }

  const props = PropertiesService.getScriptProperties();
  const keyName = 'AI_API_KEY_' + provider.toUpperCase();

  props.deleteProperty(keyName);
  tursoSetConfig('AI_PROVIDER_' + provider.toUpperCase() + '_ENABLED', 'false', 'GLOBAL');

  logAuditEvent('REMOVE_AI_KEY', 'CONFIG', provider, null, null, user.user_id, user.email);

  return { success: true };
}

/**
 * Get AI configuration status
 */
function getAIConfigStatus() {
  const providers = {};

  Object.values(AI_CONFIG.PROVIDERS).forEach(provider => {
    const key = getAIApiKey(provider);
    const enabled = getConfigValue('AI_PROVIDER_' + provider.toUpperCase() + '_ENABLED') === 'true';

    providers[provider] = {
      configured: !!key,
      enabled: enabled,
      keyMasked: key ? '****' + key.slice(-4) : null
    };
  });

  const activeProvider = getConfigValue('AI_ACTIVE_PROVIDER') || null;

  return {
    providers: providers,
    activeProvider: activeProvider,
    aiEnabled: !!activeProvider && providers[activeProvider]?.configured
  };
}

/**
 * Set active AI provider
 */
function setActiveAIProvider(provider, user) {
  if (!user || user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied');
  }

  if (provider && !Object.values(AI_CONFIG.PROVIDERS).includes(provider)) {
    throw new Error('Invalid provider: ' + provider);
  }

  if (provider) {
    const key = getAIApiKey(provider);
    if (!key) {
      throw new Error('API key not configured for ' + provider);
    }
  }

  tursoSetConfig('AI_ACTIVE_PROVIDER', provider || '', 'GLOBAL');

  return { success: true, provider: provider };
}

/**
 * Validate API key format
 */
function validateApiKeyFormat(provider, key) {
  if (!key || typeof key !== 'string') return false;

  switch (provider) {
    case AI_CONFIG.PROVIDERS.OPENAI:
      return key.startsWith('sk-') && key.length > 20;
    case AI_CONFIG.PROVIDERS.ANTHROPIC:
      return key.startsWith('sk-ant-') && key.length > 20;
    case AI_CONFIG.PROVIDERS.GOOGLE_AI:
      return key.length > 20;
    default:
      return key.length > 10;
  }
}

function callAI(prompt, systemPrompt, options) {
  const activeProvider = getConfigValue('AI_ACTIVE_PROVIDER');

  if (!activeProvider) {
    throw new Error('No AI provider configured. Contact administrator.');
  }

  const apiKey = getAIApiKey(activeProvider);
  if (!apiKey) {
    throw new Error('AI API key not found for provider: ' + activeProvider);
  }

  options = options || {};

  switch (activeProvider) {
    case AI_CONFIG.PROVIDERS.OPENAI:
      return callOpenAI(apiKey, prompt, systemPrompt, options);
    case AI_CONFIG.PROVIDERS.ANTHROPIC:
      return callAnthropic(apiKey, prompt, systemPrompt, options);
    case AI_CONFIG.PROVIDERS.GOOGLE_AI:
      return callGoogleAI(apiKey, prompt, systemPrompt, options);
    default:
      throw new Error('Unsupported AI provider: ' + activeProvider);
  }
}

/**
 * OpenAI API call
 */
function callOpenAI(apiKey, prompt, systemPrompt, options) {
  const model = options.model || AI_CONFIG.MODELS.OPENAI.GPT35;
  const maxTokens = options.maxTokens || AI_CONFIG.MAX_TOKENS;
  const temperature = options.temperature !== undefined ? options.temperature : AI_CONFIG.TEMPERATURE;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const payload = {
    model: model,
    messages: messages,
    max_tokens: maxTokens,
    temperature: temperature
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (result.error) {
    throw new Error('OpenAI API error: ' + result.error.message);
  }

  return {
    content: result.choices[0]?.message?.content || '',
    usage: result.usage,
    provider: 'openai',
    model: model
  };
}

/**
 * Anthropic API call
 */
function callAnthropic(apiKey, prompt, systemPrompt, options) {
  const model = options.model || AI_CONFIG.MODELS.ANTHROPIC.CLAUDE35;
  const maxTokens = options.maxTokens || AI_CONFIG.MAX_TOKENS;

  const payload = {
    model: model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  };

  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (result.error) {
    throw new Error('Anthropic API error: ' + result.error.message);
  }

  return {
    content: result.content[0]?.text || '',
    usage: result.usage,
    provider: 'anthropic',
    model: model
  };
}

/**
 * Google AI API call
 */
function callGoogleAI(apiKey, prompt, systemPrompt, options) {
  const model = options.model || AI_CONFIG.MODELS.GOOGLE_AI.GEMINI;

  const fullPrompt = systemPrompt ? systemPrompt + '\n\n' + prompt : prompt;

  const payload = {
    contents: [{
      parts: [{ text: fullPrompt }]
    }],
    generationConfig: {
      maxOutputTokens: options.maxTokens || AI_CONFIG.MAX_TOKENS,
      temperature: options.temperature !== undefined ? options.temperature : AI_CONFIG.TEMPERATURE
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());

  if (result.error) {
    throw new Error('Google AI API error: ' + result.error.message);
  }

  return {
    content: result.candidates?.[0]?.content?.parts?.[0]?.text || '',
    provider: 'google_ai',
    model: model
  };
}

function getWorkPaperInsights(workPaperId, user) {
  if (!user) throw new Error('User required');

  // Check if AI is enabled
  const aiStatus = getAIConfigStatus();
  if (!aiStatus.aiEnabled) {
    return { success: false, error: 'AI features are not enabled. Contact administrator.' };
  }

  // Get work paper
  const workPaper = getWorkPaperFull(workPaperId);
  if (!workPaper) {
    return { success: false, error: 'Work paper not found' };
  }

  // Prepare context
  const context = buildWorkPaperContext(workPaper);

  // System prompt for work paper analysis
  const systemPrompt = `You are an experienced internal auditor assistant. Analyze audit findings and provide professional insights.
Your role is to:
1. Assess the completeness and quality of the observation
2. Evaluate if the risk rating is appropriate
3. Suggest improvements to the recommendation
4. Identify potential root causes
5. Highlight any compliance considerations

Be concise, professional, and actionable in your analysis.
Format your response with clear sections using markdown.`;

  const userPrompt = `Please analyze this audit work paper and provide insights:

**Observation Title:** ${workPaper.observation_title || 'Not provided'}

**Observation Description:**
${workPaper.observation_description || 'Not provided'}

**Risk Rating:** ${workPaper.risk_rating || 'Not rated'}

**Risk Summary:**
${workPaper.risk_summary || 'Not provided'}

**Recommendation:**
${workPaper.recommendation || 'Not provided'}

**Control Objectives:**
${workPaper.control_objectives || 'Not provided'}

**Audit Area:** ${workPaper.audit_area_id || 'Not specified'}

**Action Plans:** ${workPaper.actionPlans?.length || 0} action plan(s) created

Please provide:
1. **Quality Assessment** - Evaluate the completeness of the finding
2. **Risk Rating Validation** - Is the risk rating appropriate? Why or why not?
3. **Recommendation Enhancement** - Suggestions to strengthen the recommendation
4. **Root Cause Analysis** - Potential underlying causes to consider
5. **Best Practice Tips** - Industry best practices relevant to this finding`;

  try {
    const aiResponse = callAI(userPrompt, systemPrompt, { maxTokens: 1500 });

    // Log usage
    logAuditEvent('AI_INSIGHTS', 'WORK_PAPER', workPaperId, null,
      { provider: aiResponse.provider, usage: aiResponse.usage }, user.user_id, user.email);

    var _pt = (aiResponse.usage && (aiResponse.usage.prompt_tokens || aiResponse.usage.input_tokens)) || 0;
    var _ct = (aiResponse.usage && (aiResponse.usage.completion_tokens || aiResponse.usage.output_tokens)) || 0;
    tursoQuery_SQL(
      'INSERT INTO ai_invocations (invocation_id, organization_id, user_id, provider_code, model, purpose, related_entity_type, related_entity_id, prompt_tokens, completion_tokens, total_tokens, success, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [generateId('AIV'), user.organization_id || 'HASS', user.user_id,
       aiResponse.provider, aiResponse.model || '', 'WORK_PAPER_INSIGHTS', 'WORK_PAPER', workPaperId,
       _pt, _ct, (aiResponse.usage && aiResponse.usage.total_tokens) || (_pt + _ct), 1,
       new Date().toISOString()]
    );

    return {
      success: true,
      insights: aiResponse.content,
      provider: aiResponse.provider,
      disclaimer: 'AI-generated insights are for reference only. Please verify recommendations with professional judgment and organizational policies.',
      generatedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('AI insights error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Build context from work paper for AI
 */
function buildWorkPaperContext(workPaper) {
  return {
    title: workPaper.observation_title,
    description: workPaper.observation_description,
    riskRating: workPaper.risk_rating,
    riskSummary: workPaper.risk_summary,
    recommendation: workPaper.recommendation,
    controlObjectives: workPaper.control_objectives,
    testingSteps: workPaper.testing_steps,
    managementResponse: workPaper.management_response,
    auditArea: workPaper.audit_area_id,
    actionPlansCount: workPaper.actionPlans?.length || 0
  };
}

function validateActionPlan(actionPlanData, workPaperContext, user) {
  if (!user) throw new Error('User required');

  const aiStatus = getAIConfigStatus();
  if (!aiStatus.aiEnabled) {
    // Return basic validation if AI is disabled
    return basicActionPlanValidation(actionPlanData);
  }

  const systemPrompt = `You are an internal audit quality reviewer. Your task is to evaluate action plans for completeness, specificity, and effectiveness.

Evaluate action plans on:
1. SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
2. Clear ownership and accountability
3. Realistic timeline
4. Direct addressing of the finding/root cause
5. Sufficient detail for implementation

Respond in JSON format with this structure:
{
  "isValid": true/false,
  "score": 0-100,
  "issues": ["list of specific issues"],
  "suggestions": ["list of improvement suggestions"],
  "strengths": ["list of positive aspects"]
}`;

  const userPrompt = `Evaluate this action plan:

**Action Description:**
${actionPlanData.action_description || 'Not provided'}

**Owner(s):** ${actionPlanData.owner_names || 'Not specified'}

**Due Date:** ${actionPlanData.due_date || 'Not specified'}

**Related Finding (for context):**
${workPaperContext?.observation_title || 'Unknown'}
${workPaperContext?.observation_description || ''}

**Risk Rating:** ${workPaperContext?.risk_rating || 'Unknown'}

Provide a thorough evaluation.`;

  try {
    const aiResponse = callAI(userPrompt, systemPrompt, { temperature: 0.2 });

    var _pt = (aiResponse.usage && (aiResponse.usage.prompt_tokens || aiResponse.usage.input_tokens)) || 0;
    var _ct = (aiResponse.usage && (aiResponse.usage.completion_tokens || aiResponse.usage.output_tokens)) || 0;
    tursoQuery_SQL(
      'INSERT INTO ai_invocations (invocation_id, organization_id, user_id, provider_code, model, purpose, related_entity_type, related_entity_id, prompt_tokens, completion_tokens, total_tokens, success, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [generateId('AIV'), user.organization_id || 'HASS', user.user_id,
       aiResponse.provider, aiResponse.model || '', 'VALIDATE_ACTION_PLAN', null, null,
       _pt, _ct, (aiResponse.usage && aiResponse.usage.total_tokens) || (_pt + _ct), 1,
       new Date().toISOString()]
    );

    // Parse JSON response
    let validation;
    try {
      // Extract JSON from response (it might be wrapped in markdown code blocks)
      const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
      validation = jsonMatch ? JSON.parse(jsonMatch[0]) : { isValid: true, score: 70 };
    } catch (parseError) {
      // If JSON parsing fails, do basic validation
      validation = basicActionPlanValidation(actionPlanData);
      validation.aiResponse = aiResponse.content;
    }

    return {
      success: true,
      validation: validation,
      provider: aiResponse.provider,
      disclaimer: 'AI validation is advisory. Use professional judgment for final approval.'
    };

  } catch (error) {
    console.error('AI validation error:', error);
    // Fall back to basic validation
    return {
      success: true,
      validation: basicActionPlanValidation(actionPlanData),
      error: 'AI validation unavailable, using basic validation'
    };
  }
}

/**
 * Basic validation without AI
 */
function basicActionPlanValidation(actionPlanData) {
  const issues = [];
  const suggestions = [];
  let score = 100;

  // Check description
  if (!actionPlanData.action_description || actionPlanData.action_description.length < 50) {
    issues.push('Action description is too brief');
    suggestions.push('Provide more detail about the specific actions to be taken');
    score -= 20;
  }

  // Check owner
  if (!actionPlanData.owner_ids && !actionPlanData.owner_names) {
    issues.push('No owner assigned');
    suggestions.push('Assign a responsible owner for accountability');
    score -= 25;
  }

  // Check due date
  if (!actionPlanData.due_date) {
    issues.push('No due date specified');
    suggestions.push('Set a realistic target completion date');
    score -= 20;
  } else {
    const dueDate = new Date(actionPlanData.due_date);
    const today = new Date();
    const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
      issues.push('Due date is in the past');
      suggestions.push('Update the due date to a future date');
      score -= 15;
    } else if (daysDiff > 365) {
      suggestions.push('Consider if a 1+ year timeline is realistic');
    }
  }

  // Check for action verbs
  const actionVerbs = ['implement', 'develop', 'create', 'establish', 'review', 'update', 'train', 'document'];
  const descLower = (actionPlanData.action_description || '').toLowerCase();
  const hasActionVerb = actionVerbs.some(verb => descLower.includes(verb));

  if (!hasActionVerb) {
    suggestions.push('Use clear action verbs (implement, develop, establish, etc.)');
    score -= 5;
  }

  return {
    isValid: score >= 60,
    score: Math.max(0, score),
    issues: issues,
    suggestions: suggestions,
    strengths: score >= 80 ? ['Action plan meets basic requirements'] : []
  };
}

function getAnalyticsInsights(analyticsData, user) {
  if (!user) throw new Error('User required');

  const aiStatus = getAIConfigStatus();
  if (!aiStatus.aiEnabled) {
    return { success: false, error: 'AI features not enabled' };
  }

  const systemPrompt = `You are an internal audit analytics expert. Analyze audit data and provide strategic insights for management.

Focus on:
1. Identifying trends and patterns
2. Highlighting areas of concern
3. Suggesting process improvements
4. Predicting potential risks
5. Recommending resource allocation

Be data-driven and strategic in your analysis.`;

  const userPrompt = `Analyze this audit portfolio data and provide strategic insights:

**Work Papers Summary:**
- Total: ${analyticsData.workPapers.total}
- By Status: ${JSON.stringify(analyticsData.workPapers.byStatus)}
- By Risk: ${JSON.stringify(analyticsData.workPapers.byRisk)}
- By Affiliate: ${JSON.stringify(analyticsData.workPapers.byAffiliate)}

**Action Plans Summary:**
- Total: ${analyticsData.actionPlans.total}
- Overdue: ${analyticsData.actionPlans.overdue}
- Implementation Rate: ${analyticsData.actionPlans.implementationRate}%
- By Status: ${JSON.stringify(analyticsData.actionPlans.byStatus)}

**Trends (Last 6 Months):**
${JSON.stringify(analyticsData.trends)}

Provide:
1. Key Observations - What stands out in this data?
2. Risk Hotspots - Areas requiring immediate attention
3. Positive Trends - What's working well?
4. Recommendations - Strategic suggestions for improvement
5. Forecast - Predicted challenges in the next quarter`;

  try {
    const aiResponse = callAI(userPrompt, systemPrompt, { maxTokens: 1500 });

    var _pt = (aiResponse.usage && (aiResponse.usage.prompt_tokens || aiResponse.usage.input_tokens)) || 0;
    var _ct = (aiResponse.usage && (aiResponse.usage.completion_tokens || aiResponse.usage.output_tokens)) || 0;
    tursoQuery_SQL(
      'INSERT INTO ai_invocations (invocation_id, organization_id, user_id, provider_code, model, purpose, related_entity_type, related_entity_id, prompt_tokens, completion_tokens, total_tokens, success, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [generateId('AIV'), user.organization_id || 'HASS', user.user_id,
       aiResponse.provider, aiResponse.model || '', 'ANALYTICS_INSIGHTS', null, null,
       _pt, _ct, (aiResponse.usage && aiResponse.usage.total_tokens) || (_pt + _ct), 1,
       new Date().toISOString()]
    );

    return {
      success: true,
      insights: aiResponse.content,
      provider: aiResponse.provider,
      generatedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Analytics AI error:', error);
    return { success: false, error: error.message };
  }
}

function testAIConnection(provider, user) {
  if (!user || user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied');
  }

  const apiKey = getAIApiKey(provider);
  if (!apiKey) {
    return { success: false, error: 'API key not configured for ' + provider };
  }

  try {
    // Save current active provider
    const currentProvider = getConfigValue('AI_ACTIVE_PROVIDER');

    // Temporarily set this provider as active
    tursoSetConfig('AI_ACTIVE_PROVIDER', provider, 'GLOBAL');

    // Test with a simple prompt
    const result = callAI('Say "Hello, AI connection successful!" in one sentence.',
      'You are a helpful assistant.', { maxTokens: 50 });

    // Restore original provider
    tursoSetConfig('AI_ACTIVE_PROVIDER', currentProvider || '', 'GLOBAL');

    return {
      success: true,
      message: 'Connection successful',
      response: result.content,
      provider: provider,
      model: result.model
    };

  } catch (error) {
    return { success: false, error: error.message, provider: provider };
  }
}

function routeAIAction(action, data, user) {
  switch (action) {
    case 'getAIConfigStatus':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, config: getAIConfigStatus() };

    case 'setAIApiKey':
      return setAIApiKey(data.provider, data.apiKey, user);

    case 'removeAIApiKey':
      return removeAIApiKey(data.provider, user);

    case 'setActiveAIProvider':
      return setActiveAIProvider(data.provider, user);

    case 'testAIConnection':
      return testAIConnection(data.provider, user);

    case 'getWorkPaperInsights':
      return getWorkPaperInsights(data.workPaperId, user);

    case 'validateActionPlan':
      return validateActionPlan(data.actionPlan, data.workPaperContext, user);

    case 'getAnalyticsInsights':
      return getAnalyticsInsights(data.analyticsData, user);

    default:
      return { success: false, error: 'Unknown AI action: ' + action };
  }
}

// ─────────────────────────────────────────────────────────────
// AI Auto-Evaluation of Auditee Responses
// ─────────────────────────────────────────────────────────────

function evaluateAuditeeResponse(workPaperId, managementResponse, actionPlanIds, workPaper) {
  var observation = workPaper.observation_description || '';
  var recommendation = workPaper.recommendation || '';
  var riskRating = workPaper.risk_rating || '';
  var title = workPaper.observation_title || '';

  // Get action plan descriptions
  var actionPlanDescs = [];
  if (actionPlanIds && actionPlanIds.length > 0) {
    actionPlanIds.forEach(function(apId) {
      try {
        var ap = getActionPlanById(apId);
        if (ap) actionPlanDescs.push(ap.action_description + ' (Due: ' + (ap.due_date || 'Not set') + ')');
      } catch (e) { /* skip */ }
    });
  }

  var systemPrompt = 'You are an internal audit quality assurance reviewer. ' +
    'Your task is to evaluate whether a management response and proposed action plans ' +
    'adequately address an audit observation. Be strict but fair. ' +
    'A response is inadequate if it: (1) does not acknowledge the observation, ' +
    '(2) provides vague or generic commitments without specific actions, ' +
    '(3) has no action plans or action plans with no due dates, ' +
    '(4) does not address the root cause identified in the recommendation, ' +
    '(5) proposes timelines that are unreasonably long for the risk level. ' +
    'Respond ONLY with JSON: {"adequate": true/false, "score": 0-100, "feedback": "specific explanation"}';

  var userPrompt = 'Evaluate this management response:\n\n' +
    'AUDIT OBSERVATION: ' + title + '\n' +
    'DESCRIPTION: ' + observation + '\n' +
    'RISK RATING: ' + riskRating + '\n' +
    'AUDITOR RECOMMENDATION: ' + recommendation + '\n\n' +
    'MANAGEMENT RESPONSE: ' + managementResponse + '\n\n' +
    'PROPOSED ACTION PLANS:\n' + (actionPlanDescs.length > 0 ? actionPlanDescs.join('\n') : 'None proposed') + '\n\n' +
    'Is this response adequate? Respond with JSON only.';

  try {
    var aiResponse = callAI(userPrompt, systemPrompt, { temperature: 0.2, maxTokens: 500 });

    var _pt = (aiResponse.usage && (aiResponse.usage.prompt_tokens || aiResponse.usage.input_tokens)) || 0;
    var _ct = (aiResponse.usage && (aiResponse.usage.completion_tokens || aiResponse.usage.output_tokens)) || 0;
    tursoQuery_SQL(
      'INSERT INTO ai_invocations (invocation_id, organization_id, user_id, provider_code, model, purpose, related_entity_type, related_entity_id, prompt_tokens, completion_tokens, total_tokens, success, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [generateId('AIV'), 'HASS', null,
       aiResponse.provider, aiResponse.model || '', 'EVALUATE_AUDITEE_RESPONSE', 'WORK_PAPER', workPaperId,
       _pt, _ct, (aiResponse.usage && aiResponse.usage.total_tokens) || (_pt + _ct), 1,
       new Date().toISOString()]
    );

    var jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    var parsed = JSON.parse(jsonMatch[0]);
    var threshold = getConfigInt('AI_REJECTION_THRESHOLD', 50);
    return {
      autoReject: parsed.adequate === false && (parsed.score || 0) < threshold,
      feedback: parsed.feedback || 'Response does not adequately address the audit observation.',
      score: parsed.score || 0
    };
  } catch (e) {
    console.warn('AI evaluation failed:', e.message);
    return null;
  }
}
