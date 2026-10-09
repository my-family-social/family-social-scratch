import * as React from 'react';
import { Resend } from 'resend';
import TwoFactorCodeEmail from '@/components/emails/templates/two-factor-code-email';
import { familySocialEmail, familySocialHostReference } from '@/features/family/constants/family-steps';

export const sendTwoFactorCodeEmail = async ({
  email,
  code,
  expiresInMinutes,
}: {
  email: string;
  code: string;
  expiresInMinutes: number;
}) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error('[email.sendTwoFactorCodeEmail] RESEND_API_KEY is missing');
    return {
      error: true,
      message: 'Sign-in email is unavailable. Please contact the site administrator.',
    };
  }

  const resend = new Resend(apiKey);
  const siteUrl = process.env.SITE_BASE_URL ?? familySocialHostReference;

  const sendResult = await resend.emails.send({
    from: familySocialEmail,
    subject: 'Your My Family Social sign-in code',
    to: email,
    react: React.createElement(TwoFactorCodeEmail, {
      code,
      expiresInMinutes,
      siteUrl,
    }),
  });

  if (sendResult.error) {
    return {
      error: true,
      message: sendResult.error.message ?? 'The 2FA email could not be sent',
    };
  }

  return {
    error: false,
  };
};
