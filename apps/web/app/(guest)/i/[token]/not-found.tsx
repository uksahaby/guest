/**
 * Garbage, forged, revoked and stale tokens all land here — the API
 * answers a uniform 404, so this page reveals nothing about why.
 */
export default function InvitationNotFound() {
  return (
    <div className="frame">
      <header className="hero" style={{ minHeight: "60dvh" }}>
        <div className="rule" />
        <p className="invited">
          This link doesn&rsquo;t open an invitation.
          <br />
          It may have been replaced — ask your host
          <br />
          for a fresh one.
        </p>
        <div className="rule" />
      </header>
    </div>
  );
}
