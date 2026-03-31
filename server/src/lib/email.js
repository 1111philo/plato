import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_FROM_EMAIL, APP_URL } from '../config.js';

const ses = new SESClient({});

export async function sendInviteEmail(toEmail, inviteToken, invitedByName) {
  const signupUrl = `${APP_URL}?token=${inviteToken}`;

  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[SKIP_EMAIL] Invite for ${toEmail}: ${signupUrl}`);
    return { skipped: true, signupUrl };
  }

  const subject = 'You\'re invited to plato';
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: #470d99; color: #fff; padding: 16px 20px; border-radius: 8px 8px 0 0; font-weight: 700;">
        plato
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; padding: 24px 20px;">
        <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">
          ${invitedByName ? `${invitedByName} has` : 'You\'ve been'} invited you to join <strong>plato</strong>.
        </p>
        <a href="${signupUrl}" style="display: inline-block; background: #470d99; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Create your account
        </a>
        <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 20px 0 0;">
          This invite expires in 7 days. If you didn't expect this, you can ignore it.
        </p>
      </div>
    </div>
  `;

  await ses.send(new SendEmailCommand({
    Source: `plato <${SES_FROM_EMAIL}>`,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));

  return { sent: true, signupUrl };
}

export async function sendResetEmail(toEmail, resetToken) {
  const resetUrl = `${APP_URL}?reset=${resetToken}`;

  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[SKIP_EMAIL] Reset for ${toEmail}: ${resetUrl}`);
    return { skipped: true, resetUrl };
  }

  const subject = 'Reset your plato password';
  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: #470d99; color: #fff; padding: 16px 20px; border-radius: 8px 8px 0 0; font-weight: 700;">
        plato
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; padding: 24px 20px;">
        <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">
          A password reset was requested for your account. Click the button below to set a new password.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: #470d99; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Reset password
        </a>
        <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 20px 0 0;">
          This link expires in 1 hour. If you didn't request this, you can ignore it.
        </p>
      </div>
    </div>
  `;

  await ses.send(new SendEmailCommand({
    Source: `plato <${SES_FROM_EMAIL}>`,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));

  return { sent: true, resetUrl };
}
