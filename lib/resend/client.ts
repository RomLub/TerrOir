import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  throw new Error("Missing RESEND_API_KEY env variable");
}

const fromEmail = process.env.RESEND_FROM_EMAIL;

if (!fromEmail) {
  throw new Error("Missing RESEND_FROM_EMAIL env variable");
}

export const resend = new Resend(apiKey);
export const resendFromEmail: string = fromEmail;
