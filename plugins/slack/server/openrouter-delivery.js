export async function deliverOpenRouterKey({ payload, settings, slack, logger = console }) {
  if (payload.slackDmAllowed !== true) return { delivered: false, reason: 'not_allowed' };
  if (!settings?.botToken) return { delivered: false, reason: 'not_configured' };

  const user = await slack.findUserByEmail(payload.userEmail);
  if (!user?.id) return { delivered: false, reason: 'user_not_found' };

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
    logger.error?.('slack_openrouter_key_delivery_failed', { error: err.message });
    return { delivered: false, reason: 'send_failed' };
  }
}
