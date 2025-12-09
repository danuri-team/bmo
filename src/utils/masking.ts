export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) {
    return "***";
  }

  const [local, domain] = email.split("@");
  const [domainName, tld] = domain.split(".");

  const maskedLocal =
    local.length <= 2
      ? local[0] + "***"
      : local[0] + "***" + local[local.length - 1];

  const maskedDomain =
    domainName.length <= 2
      ? domainName[0] + "***"
      : domainName[0] + "***" + domainName[domainName.length - 1];

  return `${maskedLocal}@${maskedDomain}.${tld}`;
}

export function maskSensitiveData(data: any): any {
  if (Array.isArray(data)) {
    return data.map(maskSensitiveData);
  }

  if (typeof data === "object" && data !== null) {
    const masked: any = {};

    for (const [key, value] of Object.entries(data)) {
      if (key.toLowerCase().includes("email")) {
        masked[key] = typeof value === "string" ? maskEmail(value) : value;
      } else if (
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("secret")
      ) {
        masked[key] = "***REDACTED***";
      } else {
        masked[key] = maskSensitiveData(value);
      }
    }

    return masked;
  }

  return data;
}
