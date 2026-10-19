/**
 * 生成自签名证书（Node 内置 crypto，无外部依赖）
 * 输出: certs/cert.pem + certs/key.pem
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "certs");
fs.mkdirSync(outDir, { recursive: true });

// ---------- DER helpers ----------
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let x = n;
  while (x > 0) {
    bytes.unshift(x & 0xff);
    x >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derInt(buf) {
  let b = Buffer.from(buf);
  // strip leading zeros
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
}

function derSeq(parts) {
  return der(0x30, Buffer.concat(parts));
}

function derSet(parts) {
  return der(0x31, Buffer.concat(parts));
}

function derOid(oid) {
  // e.g. "1.2.840.113549.1.1.11"
  const parts = oid.split(".").map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const stack = [];
    if (v === 0) stack.push(0);
    while (v > 0) {
      stack.unshift(v & 0x7f);
      v >>= 7;
    }
    for (let j = 0; j < stack.length - 1; j++) stack[j] |= 0x80;
    bytes.push(...stack);
  }
  return der(0x06, Buffer.from(bytes));
}

function derNull() {
  return Buffer.from([0x05, 0x00]);
}

function derUtf8(s) {
  return der(0x0c, Buffer.from(s, "utf8"));
}

function derPrintable(s) {
  return der(0x13, Buffer.from(s, "utf8"));
}

function derBitString(buf) {
  return der(0x03, Buffer.concat([Buffer.from([0]), buf]));
}

function derOctet(buf) {
  return der(0x04, buf);
}

function derExplicit(tagNum, content) {
  return der(0xa0 | tagNum, content);
}

function derUtcTime(date) {
  // YYMMDDHHMMSSZ
  const y = date.getUTCFullYear() % 100;
  const pad = (n) => String(n).padStart(2, "0");
  const s =
    pad(y) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return der(0x17, Buffer.from(s, "ascii"));
}

function nameCn(commonName, org) {
  // SEQUENCE OF SET OF SEQUENCE {OID, value}
  const attr = (oid, val) => derSet([derSeq([derOid(oid), val])]);
  return derSeq([
    attr("2.5.4.10", derUtf8(org)), // O
    attr("2.5.4.3", derUtf8(commonName)), // CN
  ]);
}

function pem(label, derBuf) {
  const b64 = derBuf.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

// ---------- generate ----------
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" },
});

// SPKI already DER; extract subjectPublicKey for cert
// SubjectPublicKeyInfo ::= SEQUENCE { algorithm, subjectPublicKey BIT STRING }
const spki = publicKey;
const spkiSeq = (() => {
  // parse: 0x30 | len | content
  // content = alg seq + bit string
  // we can just use the full SPKI as SubjectPublicKeyInfo in the cert
  return spki;
})();

const serial = Buffer.from(crypto.randomBytes(8));
serial[0] &= 0x7f; // keep positive

const notBefore = new Date(Date.now() - 24 * 3600 * 1000);
const notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);

const issuerName = nameCn("Yuancun Local", "Yuancun");
const subjectName = issuerName;

// extensions
const extKeyUsage = derSeq([
  derOid("2.5.29.37"), // extKeyUsage
  derOctet(derSeq([derOid("1.3.6.1.5.5.7.3.1")])), // serverAuth
]);

const san = (() => {
  // GeneralNames ::= SEQUENCE OF GeneralName
  // dNSName [2] IA5String, iPAddress [7] OCTET STRING
  const dns = (s) => der(0x82, Buffer.from(s, "ascii"));
  const ip = (a) => {
    const parts = a.split(".").map(Number);
    return der(0x87, Buffer.from(parts));
  };
  const names = derSeq([
    dns("localhost"),
    dns("yuancun.local"),
    ip("127.0.0.1"),
    ip("192.168.31.41"),
    ip("0.0.0.0"),
  ]);
  return derSeq([derOid("2.5.29.17"), derOctet(names)]);
})();

const extBasic = derSeq([
  derOid("2.5.29.19"), // basicConstraints
  derOctet(derSeq([])), // CA: false (empty seq is fine as not-Critical CA false; omit cA)
]);

// Actually basicConstraints with cA=FALSE
const extBasic2 = derSeq([
  derOid("2.5.29.19"),
  derOctet(derSeq([der(0x01, Buffer.from([0]))])), // BOOLEAN FALSE
]);

const extensions = derExplicit(3, derSeq([extBasic2, extKeyUsage, san]));

const tbs = derSeq([
  derExplicit(0, derInt(Buffer.from([2]))), // version v3
  derInt(serial),
  derSeq([derOid("1.2.840.113549.1.1.11"), derNull()]), // sha256WithRSA
  issuerName,
  derSeq([derUtcTime(notBefore), derUtcTime(notAfter)]),
  subjectName,
  spkiSeq,
  extensions,
]);

// sign
const keyObj = crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" });
const signer = crypto.createSign("sha256");
signer.update(tbs);
signer.end();
const signature = signer.sign(keyObj);

const certDer = derSeq([
  tbs,
  derSeq([derOid("1.2.840.113549.1.1.11"), derNull()]),
  derBitString(signature),
]);

fs.writeFileSync(path.join(outDir, "cert.pem"), pem("CERTIFICATE", certDer));
fs.writeFileSync(path.join(outDir, "key.pem"), pem("PRIVATE KEY", privateKey));

// verify
const x = new crypto.X509Certificate(fs.readFileSync(path.join(outDir, "cert.pem")));
const pk = crypto.createPrivateKey(fs.readFileSync(path.join(outDir, "key.pem")));
console.log("cert_subject=", x.subject);
console.log("key_match=", x.checkPrivateKey(pk));
console.log("written", path.join(outDir, "cert.pem"), path.join(outDir, "key.pem"));
