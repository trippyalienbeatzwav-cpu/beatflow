// Transactional mail. Development writes to a local outbox (visible at Settings → Developer outbox) so
// verification codes can be read without an email provider. Production needs a real provider
// (SMTP / SES / Postmark); until one is configured, sending fails closed.
import { id } from "../lib/ids.js";
import { HttpError } from "../lib/http.js";

export function createMailer(S) {
  if (S.cfg.devTools) {
    return {
      name: "dev-outbox", available: true,
      send({ userId, subject, body }) {
        S.db.run("INSERT INTO dev_outbox (id, user_id, subject, body, created_at) VALUES (?,?,?,?,?)", id("mail"), userId, subject, body, Date.now());
        S.rt?.toUser(userId, { t: "dev_mail", subject });
      },
    };
  }
  return { name: "none", available: false, send() { throw new HttpError(503, "mail_not_configured", "Email delivery is not configured."); } };
}
