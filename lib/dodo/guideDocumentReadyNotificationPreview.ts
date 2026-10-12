export type GuideDocumentReadyNotificationPreview = Readonly<{
  schemaVersion: 1;
  channelLabel: "WeChat通知の表示例";
  title: "書類の準備ができました";
  body: string;
  actionLabel: "DODOで確認する";
  privacyNote: string;
  deliveryEnabled: false;
}>;

/**
 * Returns the minimal public copy for local review. It deliberately contains
 * no identity, payment, document-body, authentication, or signed-link data.
 */
export function createGuideDocumentReadyNotificationPreview(): GuideDocumentReadyNotificationPreview {
  return Object.freeze({
    schemaVersion: 1,
    channelLabel: "WeChat通知の表示例",
    title: "書類の準備ができました",
    body: "DODOに新しい書類があります。本人確認後に専用ページでご確認ください。",
    actionLabel: "DODOで確認する",
    privacyNote: "金額・口座情報・書類本文・認証コードは通知に記載しません。",
    deliveryEnabled: false,
  });
}
