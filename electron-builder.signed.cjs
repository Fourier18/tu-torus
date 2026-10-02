// Signed build (npm run package:signed): the normal build settings from
// package.json, plus signing through Microsoft's Azure Artifact Signing, so
// Windows can show who published the installer. Needs an Artifact Signing
// account with a validated identity and a certificate profile, and these
// set in the environment:
//
//   TU_TORUS_SIGN_ENDPOINT   the account's region endpoint, e.g. https://eus.codesigning.azure.net/
//   TU_TORUS_SIGN_ACCOUNT    the Artifact Signing account name
//   TU_TORUS_SIGN_PROFILE    the certificate profile name
//   TU_TORUS_SIGN_PUBLISHER  the validated name, exactly as on the certificate
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//                            an app registration allowed to sign with that profile
//
// The ordinary build (npm run package) stays unsigned and needs none of this.
const { build } = require("./package.json");

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} isn't set — see electron-builder.signed.cjs for what a signed build needs.`);
  return value;
};
for (const name of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]) env(name);

module.exports = {
  ...build,
  win: {
    ...build.win,
    azureSignOptions: {
      endpoint: env("TU_TORUS_SIGN_ENDPOINT"),
      codeSigningAccountName: env("TU_TORUS_SIGN_ACCOUNT"),
      certificateProfileName: env("TU_TORUS_SIGN_PROFILE"),
      publisherName: env("TU_TORUS_SIGN_PUBLISHER"),
    },
  },
};
