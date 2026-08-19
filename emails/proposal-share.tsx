import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import { COMPANY_NAME } from "@/lib/company-data";

type ProposalShareEmailProps = {
  recipientName: string;
  title: string;
  proposalNumber: string | null;
  url: string;
  expiresAt: string | null;
};

const main = {
  backgroundColor: "#f5f7fb",
  color: "#172033",
  fontFamily: "Arial, sans-serif",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #d9e0ea",
  borderRadius: "8px",
  margin: "0 auto",
  padding: "28px",
  width: "560px",
};

const button = {
  backgroundColor: "#0f2f4f",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  fontWeight: 700,
  padding: "10px 14px",
  textDecoration: "none",
};

function formatExpiry(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function ProposalShareEmail({ recipientName, title, proposalNumber, url, expiresAt }: ProposalShareEmailProps) {
  const expiry = formatExpiry(expiresAt);
  const greetingName = recipientName.trim();

  return (
    <Html>
      <Head />
      <Preview>{`${COMPANY_NAME} sent you a proposal: ${title}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text
            style={{
              color: "#657286",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              margin: "0 0 6px",
              textTransform: "uppercase",
            }}
          >
            {proposalNumber ?? "Proposal"}
          </Text>
          <Heading as="h1" style={{ fontSize: "22px", margin: "0 0 10px" }}>
            {title}
          </Heading>
          <Text style={{ margin: "0 0 16px" }}>
            {greetingName ? `${greetingName}, ` : ""}
            {COMPANY_NAME} has sent you a proposal to review{expiry ? `. It is open for acceptance through ${expiry}` : ""}.
          </Text>
          <Link href={url} style={button}>
            View the proposal
          </Link>
          <Hr />
          <Text style={{ color: "#657286", fontSize: "12px" }}>
            This link is unique to you — please don&apos;t forward it. Questions? Reply to whoever sent this to you.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
