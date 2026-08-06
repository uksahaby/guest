import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_MAIN, ADMIN_TOOLS, AdminIcon } from "../nav";

/**
 * The sections the sidebar names and the platform cannot yet do.
 *
 * They exist as pages rather than as dead links because the shape of the
 * administrator's job is part of the design — but each one says what it
 * would be, and why it is not there, instead of showing an empty table
 * that looks broken. Several are "not built" for a reason worth reading
 * rather than an omission: there are no subscriptions because nothing
 * recurs, and no payouts because Paystack settles to one account.
 */

const ALL = [...ADMIN_MAIN, ...ADMIN_TOOLS];

export function generateStaticParams() {
  return ALL.filter((i) => !i.built).map((i) => ({
    section: i.href.replace("/admin/", ""),
  }));
}

export default async function AdminSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const item = ALL.find((i) => i.href === `/admin/${section}`);
  if (!item || item.built) notFound();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">{item.label}</h1>
          <p className="sub" style={{ marginTop: 2 }}>Not built yet.</p>
        </div>
      </div>

      <div className="card notyet">
        <span className="notyet-icon"><AdminIcon name={item.icon} /></span>
        <div>
          <p className="sub" style={{ marginTop: 0, maxWidth: "62ch" }}>{item.note}</p>
          <p className="sub sm" style={{ maxWidth: "62ch" }}>
            It has a place in the sidebar so the shape of the job is honest.
            There are no controls on this page because a control that does
            nothing is worse than an empty one.
          </p>
          <Link className="ghost" href="/admin">Back to the dashboard</Link>
        </div>
      </div>
    </>
  );
}
