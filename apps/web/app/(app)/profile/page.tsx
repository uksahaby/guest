import { api } from "@/lib/org-api";
import { uploadAvatar, removeAvatar, saveProfile } from "./actions";

/**
 * The organiser's own account: photo, name, contact.
 *
 * Reached from the profile menu in the top bar, which is also where
 * signing out lives — the two things people look for in the same corner.
 */

type Me = {
  user: {
    id: string;
    full_name: string | null;
    phone: string;
    email: string | null;
    has_avatar: boolean;
  };
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { data } = await api<Me>("/me");
  const me = data.user;

  const initials = (me.full_name ?? "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const problem: Record<string, string> = {
    no_file: "Choose an image first.",
    too_large: "That image is over 2 MB. Try a smaller one.",
    not_an_image: "That file is not a JPEG, PNG or WebP image.",
    save: "That didn't save — try again.",
    failed: "The upload failed. Try again.",
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page">Your profile</h1>
          <p className="sub">Your photo and details, as your team sees them.</p>
        </div>
      </div>

      {sp.saved && <div className="plan-line"><b>Saved.</b></div>}
      {sp.error && (
        <p className="form-error">{problem[sp.error] ?? problem.failed}</p>
      )}

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">Photo</h2>
          <div className="avatar-row">
            <span className="me-avatar big" aria-hidden="true">
              {me.has_avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/api/me/avatar" alt="" />
              ) : (
                initials || "?"
              )}
            </span>
            <div>
              <form action={uploadAvatar}>
                <input
                  className="field"
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  aria-label="Choose a photo"
                />
                <div className="form-row" style={{ marginTop: 10 }}>
                  <button className="primary" type="submit">Upload</button>
                </div>
              </form>
              {me.has_avatar && (
                <form action={removeAvatar} style={{ marginTop: 8 }}>
                  <button className="ghost sm" type="submit">Remove photo</button>
                </form>
              )}
              <p className="sub sm" style={{ marginTop: 10 }}>
                JPEG, PNG or WebP, under 2 MB.
              </p>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Details</h2>
          <form action={saveProfile}>
            <label className="lbl-block">
              <span>Full name</span>
              <input className="field" name="full_name"
                defaultValue={me.full_name ?? ""} required maxLength={120} />
            </label>
            <label className="lbl-block">
              <span>Email</span>
              <input className="field" type="email" name="email"
                defaultValue={me.email ?? ""} placeholder="Optional" />
            </label>
            <label className="lbl-block">
              <span>Phone</span>
              <input className="field" value={me.phone} disabled />
              <small className="sub sm">
                Your phone is how you sign in, so it cannot be changed here.
              </small>
            </label>
            <button className="primary" type="submit">Save</button>
          </form>
        </section>
      </div>
    </>
  );
}
