import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  preLoginAuthValidation: vi.fn(),
  findRegisteredFamily: vi.fn(),
  setCookie: vi.fn(),
}));

vi.mock('@/auth', () => ({ signIn: mocks.signIn }));
vi.mock('@/features/auth/services/auth-utils', () => ({
  preLoginAuthValidation: mocks.preLoginAuthValidation,
}));
vi.mock('@/components/db/sql/queries-user', () => ({
  getUser2fa: vi.fn(),
  upsertUser2faCode: vi.fn(),
}));
vi.mock('@/components/db/sql/queries-family-member', () => ({
  findRegisteredFamily: mocks.findRegisteredFamily,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: mocks.setCookie }),
}));
vi.mock('otplib', () => ({ generate: vi.fn() }));

describe('login actions without email configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows credential precheck and sign-in to execute', async () => {
    const { emailLoginCheck, fullLoginUser } = await import('./actions');
    const credentials = {
      email: 'member@example.com',
      password: 'Password123!',
      family: 'example_family',
    };
    mocks.preLoginAuthValidation.mockResolvedValueOnce({ error: false, isActive: false });
    mocks.signIn.mockResolvedValueOnce(undefined);

    await expect(emailLoginCheck(credentials)).resolves.toEqual({
      error: false,
      isActive: false,
    });
    await expect(fullLoginUser(credentials)).resolves.toBeUndefined();
    expect(mocks.signIn).toHaveBeenCalledWith('credentials', {
      ...credentials,
      token: undefined,
      redirect: false,
    });
  });

  it('allows Google sign-in preparation to execute', async () => {
    const { beginGoogleLogin } = await import('./actions');
    mocks.findRegisteredFamily.mockResolvedValueOnce({
      success: true,
      familyId: 12,
      familyName: 'example_family',
    });

    await expect(beginGoogleLogin({ family: 'example_family' })).resolves.toEqual({
      error: false,
    });
    expect(mocks.setCookie).toHaveBeenCalledWith(
      'oauth_family_context',
      JSON.stringify({ familyName: 'example_family', familyId: 12 }),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
    );
  });
});
