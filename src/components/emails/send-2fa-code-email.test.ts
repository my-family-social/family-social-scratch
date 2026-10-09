import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  send: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: class {
    constructor(apiKey: string) {
      resendMocks.constructor(apiKey);
      if (!apiKey) {
        throw new Error('Missing API key');
      }
    }

    emails = { send: resendMocks.send };
  },
}));

const input = {
  email: 'member@example.com',
  code: '012345',
  expiresInMinutes: 5,
};

describe('sendTwoFactorCodeEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('can be imported by login actions without an email API key', async () => {
    const emailModule = await import('./send-2fa-code-email');

    expect(emailModule.sendTwoFactorCodeEmail).toBeTypeOf('function');
    expect(resendMocks.constructor).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('reports missing configuration for key %j without sending', async (apiKey) => {
    vi.stubEnv('RESEND_API_KEY', apiKey);
    const { sendTwoFactorCodeEmail } = await import('./send-2fa-code-email');

    await expect(sendTwoFactorCodeEmail(input)).resolves.toEqual({
      error: true,
      message: 'Sign-in email is unavailable. Please contact the site administrator.',
    });
    expect(console.error).toHaveBeenCalledWith(
      '[email.sendTwoFactorCodeEmail] RESEND_API_KEY is missing',
    );
    expect(resendMocks.constructor).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it('reads the runtime key when sending and preserves the email payload', async () => {
    const { sendTwoFactorCodeEmail } = await import('./send-2fa-code-email');
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    resendMocks.send.mockResolvedValueOnce({ error: null });

    await expect(sendTwoFactorCodeEmail(input)).resolves.toEqual({ error: false });
    expect(resendMocks.constructor).toHaveBeenCalledWith('re_test_key');
    expect(resendMocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: input.email,
      subject: 'Your My Family Social sign-in code',
      react: expect.objectContaining({
        props: expect.objectContaining({
          code: input.code,
          expiresInMinutes: input.expiresInMinutes,
        }),
      }),
    }));
  });

  it('preserves the provider error result', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    resendMocks.send.mockResolvedValueOnce({ error: { message: 'Email delivery failed' } });
    const { sendTwoFactorCodeEmail } = await import('./send-2fa-code-email');

    await expect(sendTwoFactorCodeEmail(input)).resolves.toEqual({
      error: true,
      message: 'Email delivery failed',
    });
  });
});
