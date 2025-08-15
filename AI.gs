/**
 * AI INTEGRATION MODULE
 * OpenAI-powered audit assistance with role-based prompts
 */

/**
 * Generates AI insights based on context and user role
 */
function generateAIInsights(context, userRole) {
  try {
    const user = getCurrentUser();
    if (!user.permissions.includes('ai_assist')) {
      throw new Error('Insufficient permissions to use AI assistance');
    }

    const apiKey = getOpenAIAPIKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please add it in Configuration settings.');
    }

    const prompt = buildRoleBasedPrompt(context, userRole);
    const response = callOpenAI(apiKey, prompt);
    
    if (response.success) {
      // Log AI usage
      logAction('AI', context.entity || 'general', 'ai_insights', {}, {
        user: user.email,
        role: userRole,
        usage: response.usage,
        context_type: context.currentPage || 'unknown'
      });
      
      return {
        success: true,
        insight: response.content,
        usage: response.usage,
        timestamp: new Date()
      };
    } else {
      throw new Error(response.error);
    }
    
  } catch (error) {
    Logger.log('generateAIInsights error: ' + error.toString());
    return {
      success: false,
      error: error.message,
      insight: getFallbackInsight(userRole, context)
    };
  }
}

/**
 * Gets OpenAI API key from configuration
 */
function getOpenAIAPIKey() {
  try {
    const config = getConfig();
    return safeGet(config, 'OPENAI_API_KEY', '');
  } catch (error) {
    Logger.log('Error getting OpenAI API key: ' + error.toString());
    return '';
  }
}

/**
 * Builds role-based prompts for different user types
 */
function buildRoleBasedPrompt(context, userRole) {
  const baseContext = JSON.stringify(context, null, 2);
  
  const rolePrompts = {
    'AuditManager': `As a Chief Audit Executive, provide strategic insights on audit management, risk oversight, and governance improvements. Focus on high-level risk patterns and systemic issues. Context: ${baseContext}`,
    'SeniorManagement': `As an executive advisor, provide senior management insights focusing on business impact assessment and strategic risk implications. Context: ${baseContext}`,
    'Board': `As a governance expert, provide board-level oversight insights focusing on enterprise risk assessment and regulatory compliance. Context: ${baseContext}`,
    'Auditor': `As a senior audit professional, provide practical audit guidance including specific procedures and testing methodologies. Context: ${baseContext}`,
    'Auditee': `As a compliance advisor, provide clear guidance for process owners including step-by-step corrective action plans. Context: ${baseContext}`
  };

  return rolePrompts[userRole] || rolePrompts['Auditor'];
}

/**
 * Makes API call to OpenAI
 */
function callOpenAI(apiKey, prompt, maxTokens = 1500) {
  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert audit consultant with 20+ years of experience. Provide clear, actionable recommendations with professional structure.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });

    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      throw new Error(`OpenAI API Error: ${result.error.message}`);
    }
    
    if (result.choices && result.choices[0] && result.choices[0].message) {
      return {
        success: true,
        content: result.choices[0].message.content,
        usage: result.usage || {}
      };
    } else {
      throw new Error('Invalid response format from OpenAI API');
    }
    
  } catch (error) {
    Logger.log('OpenAI API call error: ' + error.toString());
    
    let errorMessage = error.message;
    if (errorMessage.includes('401')) {
      errorMessage = 'Invalid API key. Please check your OpenAI API key configuration.';
    } else if (errorMessage.includes('429')) {
      errorMessage = 'Rate limit exceeded. Please try again in a few moments.';
    } else if (errorMessage.includes('500')) {
      errorMessage = 'OpenAI service temporarily unavailable. Please try again later.';
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Provides fallback insights when AI is unavailable
 */
function getFallbackInsight(userRole, context) {
  const fallbackInsights = {
    'AuditManager': `Strategic Audit Management Insights:

• Review current audit plan effectiveness and resource allocation
• Consider implementing risk-based audit scheduling
• Enhance audit quality assurance processes
• Strengthen stakeholder communication and reporting
• Evaluate audit team competencies and training needs

Note: Full AI-powered insights require OpenAI API key configuration in Settings.`,

    'Auditor': `Audit Execution Guidance:

• Ensure comprehensive risk assessment documentation
• Implement robust sampling methodologies
• Maintain detailed working paper documentation
• Focus on control testing effectiveness
• Consider data analytics opportunities

Note: AI-powered audit suggestions available with API key configuration.`,

    'SeniorManagement': `Executive Risk Overview:

• Monitor high-risk audit findings for business impact
• Review regulatory compliance status regularly
• Assess operational efficiency opportunities
• Evaluate strategic risk implications
• Ensure adequate resource allocation for risk mitigation

Note: Enhanced executive insights available with AI integration.`,

    'Board': `Governance Oversight Summary:

• Review enterprise risk management effectiveness
• Monitor audit committee reporting quality
• Assess regulatory compliance posture
• Evaluate strategic risk appetite alignment
• Ensure adequate governance framework implementation

Note: AI-powered governance insights available with configuration.`,

    'Auditee': `Compliance Guidance:

• Address audit findings promptly and thoroughly
• Implement preventive controls where possible
• Document corrective actions clearly
• Monitor control effectiveness regularly
• Communicate progress to audit team

Note: Personalized AI assistance available with system configuration.`
  };

  return fallbackInsights[userRole] || fallbackInsights['Auditor'];
}

/**
 * Generates work paper suggestions
 */
function generateWorkPaperSuggestions(workPaperContext) {
  try {
    const user = getCurrentUser();
    if (!user.permissions.includes('ai_assist')) {
      throw new Error('Insufficient permissions to use AI assistance');
    }

    const apiKey = getOpenAIAPIKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const prompt = buildWorkPaperPrompt(workPaperContext);
    const response = callOpenAI(apiKey, prompt, 800);
    
    if (response.success) {
      return {
        success: true,
        suggestion: response.content,
        field: workPaperContext.field
      };
    } else {
      throw new Error(response.error);
    }
    
  } catch (error) {
    Logger.log('generateWorkPaperSuggestions error: ' + error.toString());
    return {
      success: false,
      error: error.message,
      suggestion: 'Unable to generate suggestions at this time.'
    };
  }
}

/**
 * Builds work paper-specific prompts
 */
function buildWorkPaperPrompt(workPaperContext) {
  const prompts = {
    'objective': `Based on the audit "${workPaperContext.auditTitle}" and process area "${workPaperContext.processArea}", suggest comprehensive audit objectives that are specific, measurable, and aligned with risk areas.`,
    'risks': `For the process area "${workPaperContext.processArea}" in audit "${workPaperContext.auditTitle}", identify key risks including operational, financial, compliance, and reputational risks.`,
    'tests': `For the process area "${workPaperContext.processArea}", suggest specific audit tests and procedures including sampling methods and documentation requirements.`
  };

  return prompts[workPaperContext.field] || prompts['tests'];
}
