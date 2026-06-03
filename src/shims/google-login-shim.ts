import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

export const GoogleLogin = {
  initialize(options: { clientId: string; scopes?: string[]; grantOfflineAccess?: boolean }) {
    if (typeof GoogleAuth.initialize === 'function') {
      return GoogleAuth.initialize(options);
    }
    return Promise.resolve();
  },
  async signIn() {
    const user = await GoogleAuth.signIn();
    return {
      email: user.email || '',
      name: user.name || '',
      imageUrl: user.imageUrl || '',
      authentication: {
        idToken: user.authentication?.idToken || '',
        accessToken: user.authentication?.accessToken || '',
      }
    };
  }
};
