// The company's standard email signature — frontend twin of
// server/services/emailSignature.cjs.
//
// It exists twice because the two halves of the app build email bodies in
// different places: the compose modal builds a draft the sender reviews before
// sending (here), while reminders and approval notices are sent without a human
// in the loop (backend). The backend image ships only server/, so it cannot
// import this module. server/services/emailSignature.test.cjs renders both and
// fails if they ever drift apart — change one, change the other.
//
// Two forms, per the agreed convention:
//   • reminders chase on behalf of the department  → signed "Die Design - GULFEX"
//   • everything else is a person writing          → signed with the user's name

// Department contact, and the fallback for a user with no details on file.
export const DIE_DESIGN = {
  name: 'Die Design - GULFEX',
  email: 'diedesign@gulfex.com',
  phone: '+971 4 8031227',
};

const COMPANY_LINE = 'Gulf Extrusion LLC | A subsidiary of Saif Al Ghurair Group LLC | DUNS No. 851016167';
const ADDRESS_LINE = 'PO Box 5598, Jebel Ali Industrial Area 1, Dubai, United Arab Emirates';
const GREEN_NOTE = 'Please consider the environment before printing';
const DISCLAIMER = 'This email is private and confidential and sent exclusively to the above recipient/s, '
  + 'if you are not the intended recipient, you are requested to delete it promptly; '
  + 'the sender reserves all the rights to all kinds of claims.';

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const who = (s) => String(s.name || '').trim() || DIE_DESIGN.name;
const mailOf = (s) => String(s.email || '').trim() || DIE_DESIGN.email;
const telOf = (s) => String(s.phone || '').trim() || DIE_DESIGN.phone;

// Signs as the given person. A login name is not a signature, so callers pass
// the user's full name where one is on file and fall back to the department
// rather than signing a supplier email "jaypee".
export function buildSignature(sig = {}) {
  return `
    <p style="margin:22px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111">Best Regards,</p>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;line-height:1.5">
      <div style="font-weight:bold;font-size:14px">${esc(who(sig))}</div>
      <div>
        <a href="mailto:${esc(mailOf(sig))}" style="color:#0563C1;text-decoration:underline">${esc(mailOf(sig))}</a>
        &nbsp;|&nbsp; D: ${esc(telOf(sig))}
      </div>
      <div><a href="https://www.gulfex.com" style="color:#0563C1;text-decoration:underline">www.gulfex.com</a></div>
    </div>
    <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333;line-height:1.6">
      <div>${COMPANY_LINE}</div>
      <div>${ADDRESS_LINE}</div>
    </div>
    <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#C8007B">${GREEN_NOTE}</div>
    <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666;line-height:1.5">${DISCLAIMER}</div>`;
}

// For the handful of bodies that are plain text rather than HTML.
export function signatureText(sig = {}) {
  return [
    '', 'Best Regards,', '',
    who(sig),
    `${mailOf(sig)} | D: ${telOf(sig)}`,
    'www.gulfex.com', '',
    COMPANY_LINE,
    ADDRESS_LINE, '',
    GREEN_NOTE,
    DISCLAIMER,
  ].join('\n');
}

// The department signature, for mail sent on behalf of Die Design rather than
// by a named person (reminders).
export const dieDesignSignature = () => buildSignature(DIE_DESIGN);
export const dieDesignSignatureText = () => signatureText(DIE_DESIGN);

// The signature for a named sender, falling back to the department when the
// account has no name/contact details filled in.
const asUser = (user) => ({
  name: user && (user.fullName || user.full_name || user.username),
  email: user && user.email,
  phone: user && user.phone,
});
export const userSignature = (user) => buildSignature(asUser(user));
export const userSignatureText = (user) => signatureText(asUser(user));
