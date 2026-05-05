export async function deliverOpenRouterKey({ payload, settings, slack, logger = console }) {
  if (payload.slackDmAllowed !== true) {
    logger.warn?.('slack_openrouter_key_delivery_skipped', { reason: 'not_allowed', userId: payload.userId });
    return { delivered: false, reason: 'not_allowed' };
  }
  if (!settings?.botToken) {
    logger.warn?.('slack_openrouter_key_delivery_skipped', { reason: 'not_configured', userId: payload.userId });
    return { delivered: false, reason: 'not_configured' };
  }

  const user = await slack.findUserByEmail(payload.userEmail);
  if (!user?.id) {
    logger.warn?.('slack_openrouter_key_delivery_skipped', { reason: 'user_not_found', userId: payload.userId, userEmail: payload.userEmail });
    return { delivered: false, reason: 'user_not_found' };
  }

  try {
    await slack.sendDm(user.id, [
      'Your OpenRouter key from plato:',
      '',
      payload.plaintext,
      '',
      'Slack may retain this message according to your workspace retention policy.',
    ].join('\n'));
    return { delivered: true };
  } catch (err) {
    logger.error?.('slack_openrouter_key_delivery_failed', { error: err.message, userId: payload.userId });
    return { delivered: false, reason: 'send_failed' };
  }
}
