/** DODO internal users share one access level; external guides sign in separately. */
export function authenticateOfficeLogin(
  loginId: string,
  password: string,
  config: { OFFICE_LOGIN_ID?: string; OFFICE_LOGIN_PASSWORD?: string } = {
    OFFICE_LOGIN_ID: process.env.OFFICE_LOGIN_ID,
    OFFICE_LOGIN_PASSWORD: process.env.OFFICE_LOGIN_PASSWORD,
  }
) {
  if (!config.OFFICE_LOGIN_ID || !config.OFFICE_LOGIN_PASSWORD) {
    return { ok: false, status: 500, error: "社内ログイン設定が未完了です。" };
  }
  if (!loginId || !password) {
    return { ok: false, status: 400, error: "ログインIDとパスワードを入力してください。" };
  }
  if (loginId !== config.OFFICE_LOGIN_ID || password !== config.OFFICE_LOGIN_PASSWORD) {
    return { ok: false, status: 401, error: "ログインIDまたはパスワードが違います。" };
  }
  return { ok: true, status: 200 };
}
