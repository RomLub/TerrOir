import { EmailLayout, emailTheme } from "./layout";

// Cluster B Phase 3 (bugs-P1-3) — template d'alerte ops.
//
// Pose un signal email sur OPS_EMAIL pour les 5 prefixes critiques drift
// Stripe/DB. Pattern fail-safe : ne throw jamais (sendTemplate consume).
//
// Body minimal et structurel : prefix + summary + error + order_id +
// timestamp + stack truncee. Pas de PII (les metadata recues sont deja
// strippees par sendOpsAlert helper, mais defense-in-depth : on n'affiche
// pas les keys arbitraires brutes — uniquement les champs whitelistes).

export interface Props {
  prefix: string;
  summary: string;
  errorMessage: string;
  orderId: string | null;
  timestamp: string;
  stack: string;
  metadata: Record<string, unknown>;
}

export const subject = (p: Props) => `[OPS] ${p.prefix} ${p.summary}`;

export default function AdminOpsAlert(props: Props) {
  // Whitelist explicite des cles affichees pour eviter de sortir
  // accidentellement un metadata avec PII via un caller buggue.
  const safeKeys = [
    "order_id",
    "producer_id",
    "stripe_account_id",
    "refund_id",
    "charge_id",
    "amount",
    "amount_refunded",
    "currency",
    "blocked_reason",
    "final_status",
    "transition_error",
    "db_error",
    "kind",
    "error_kind",
    "incident_id",
    "incident_status",
    "attempt_number",
  ];

  const filtered = Object.entries(props.metadata).filter(([k]) =>
    safeKeys.includes(k),
  );

  return (
    <EmailLayout title={subject(props)}>
      <h1 style={{ color: emailTheme.terracotta, marginTop: 0 }}>
        Alerte ops critique
      </h1>

      <p style={{ margin: "8px 0" }}>
        <strong>Prefix :</strong>{" "}
        <code>{props.prefix}</code>
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Summary :</strong> {props.summary}
      </p>
      {props.orderId ? (
        <p style={{ margin: "8px 0" }}>
          <strong>Order ID :</strong> <code>{props.orderId}</code>
        </p>
      ) : null}
      <p style={{ margin: "8px 0" }}>
        <strong>Timestamp :</strong> {props.timestamp}
      </p>
      <p style={{ margin: "8px 0" }}>
        <strong>Error :</strong> {props.errorMessage}
      </p>

      {filtered.length > 0 ? (
        <>
          <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />
          <p>
            <strong>Metadata :</strong>
          </p>
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            {filtered.map(([k, v]) => (
              <li key={k} style={{ margin: "4px 0" }}>
                <code>{k}</code> : <code>{String(v)}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p>
        <strong>Stack :</strong>
      </p>
      <pre
        style={{
          backgroundColor: "#f4f4f4",
          padding: 12,
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.4,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {props.stack}
      </pre>

      <hr style={{ border: 0, borderTop: "1px solid #eee", margin: "20px 0" }} />

      <p style={{ fontSize: 12, color: "#6b6b6b" }}>
        Cette alerte est posee par le helper sendOpsAlert (lib/ops/alert.tsx)
        sur 5 prefixes greppables critiques drift Stripe/DB. Doublee dans
        Sentry avec tags ops_prefix.
      </p>
    </EmailLayout>
  );
}
