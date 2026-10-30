import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SES_FROM_EMAIL, APP_URL } from '../config.js';
import db from './db.js';

const ses = new SESClient({});

const DEFAULT_PRIMARY = '#470d99';

/** Escape text for HTML element and attribute contexts. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** A theme color is interpolated into inline CSS — only accept a hex color. */
export function safeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : DEFAULT_PRIMARY;
}

/**
 * The From header's display name comes from admin-editable settings. Strip
 * anything that could break out of the header (CR/LF) or the quoted name.
 */
export function fromHeader(name, address = SES_FROM_EMAIL) {
  const clean = String(name || 'plato').replace(/[\r\n"<>\\]/g, '').trim() || 'plato';
  return `"${clean}" <${address}>`;
}

export async function getClassroom() {
  const item = await db.getSyncData('_system', 'settings');
  const s = item?.data || {};
  return {
    // classroomName is canonical; logoAlt is its legacy mirror (admin.js PUT /theme)
    name: s.classroomName || s.logoAlt || 'plato',
    primary: safeColor(s.theme?.primary),
  };
}

/** Classroom-branded wrapper. `body` is trusted HTML built by the caller. */
export function emailWrapper(classroom, body) {
  const primary = safeColor(classroom.primary);
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="background: ${primary}; color: #fff; padding: 16px 20px; border-radius: 8px 8px 0 0; font-weight: 700;">
        ${escapeHtml(classroom.name)}
      </div>
      <div style="border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px; padding: 24px 20px;">
        ${body}
        <p style="color: #999; font-size: 11px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
          Powered by <a href="https://github.com/1111philo/plato" style="color: #999; text-decoration: underline;">plato</a>.
        </p>
      </div>
    </div>
  `;
}

export function inviteEmailHtml(classroom, signupUrl, invitedByName) {
  const name = escapeHtml(classroom.name);
  const primary = safeColor(classroom.primary);
  return emailWrapper(classroom, `
    <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">
      ${invitedByName ? `${escapeHtml(invitedByName)} has invited you` : 'You\'ve been invited'} to join <strong>${name}</strong>, an AI-powered microlearning platform where you'll work through focused lessons in conversation with an AI coach.
    </p>
    <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">
      <strong>What to expect:</strong>
    </p>
    <ul style="color: #1a1a1a; line-height: 1.6; margin: 0 0 16px; padding-left: 24px;">
      <li>Chat with an AI coach who guides you through each lesson</li>
      <li>Upload screenshots and create artifacts as you learn</li>
      <li>Work through courses organized into focused lessons, each designed for ~20 minutes</li>
    </ul>
    <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 20px;">
      Ready to get started? Create your account and begin your first lesson.
    </p>
    <a href="${escapeHtml(signupUrl)}" style="display: inline-block; background: ${primary}; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
      Create your account
    </a>
    <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 20px 0 0;">
      This invite expires in 7 days. If you didn't expect this, you can ignore it.
    </p>
  `);
}

export function resetEmailHtml(classroom, resetUrl) {
  const primary = safeColor(classroom.primary);
  return emailWrapper(classroom, `
    <p style="color: #1a1a1a; line-height: 1.5; margin: 0 0 16px;">
      A password reset was requested for your account. Click the button below to set a new password.
    </p>
    <a href="${escapeHtml(resetUrl)}" style="display: inline-block; background: ${primary}; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
      Reset password
    </a>
    <p style="color: #555; font-size: 13px; line-height: 1.5; margin: 20px 0 0;">
      This link expires in 1 hour. If you didn't request this, you can ignore it.
    </p>
  `);
}

export async function sendInviteEmail(toEmail, inviteToken, invitedByName) {
  const signupUrl = `${APP_URL}/signup?token=${inviteToken}`;

  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[SKIP_EMAIL] Invite for ${toEmail}: ${signupUrl}`);
    return { skipped: true, signupUrl };
  }

  const classroom = await getClassroom();
  const subject = `Welcome to ${classroom.name} — Your AI-Powered Learning Journey`;
  const html = inviteEmailHtml(classroom, signupUrl, invitedByName);

  await ses.send(new SendEmailCommand({
    Source: fromHeader(classroom.name),
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));

  return { sent: true, signupUrl };
}

export async function sendResetEmail(toEmail, resetToken) {
  const resetUrl = `${APP_URL}/reset-password?reset=${resetToken}`;

  if (process.env.SKIP_EMAIL === 'true') {
    console.log(`[SKIP_EMAIL] Reset for ${toEmail}: ${resetUrl}`);
    return { skipped: true, resetUrl };
  }

  const classroom = await getClassroom();
  const subject = `Reset your ${classroom.name} password`;
  const html = resetEmailHtml(classroom, resetUrl);

  await ses.send(new SendEmailCommand({
    Source: fromHeader(classroom.name),
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: html } },
    },
  }));

  return { sent: true, resetUrl };
}
