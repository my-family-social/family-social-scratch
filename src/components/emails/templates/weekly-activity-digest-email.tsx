import { Html, Head, Body, Container, Heading, Text, Section, Button, Hr, Preview, Img, Link } from "@react-email/components";
import type { DigestActivity, DigestHighlight, DigestHighlightPost } from "@/features/weekly-activity-digest/contract";

type DashboardRow = {
  label: string;
  POST_CREATED: number;
  COMMENT_CREATED: number;
  REACTION_ADDED: number;
};

const chartSegments = [
  { key: "POST_CREATED", label: "Posts", color: "#d1d5db" },
  { key: "COMMENT_CREATED", label: "Comments", color: "#009688" },
  { key: "REACTION_ADDED", label: "Reactions", color: "#60a5fa" },
] as const;

const roomColors: Record<string, { border: string; background: string }> = {
  "tv room": { border: "#245475", background: "#edf7fb" },
  "movie theater": { border: "#d28a20", background: "#fff8eb" },
  "home theater": { border: "#d28a20", background: "#fff8eb" },
  "music salon": { border: "#3979aa", background: "#eff6ff" },
  "music room": { border: "#3979aa", background: "#eff6ff" },
  "the kitchen": { border: "#638b3d", background: "#f7fce8" },
  blogs: { border: "#b76d68", background: "#fff8f2" },
  "family blog": { border: "#b76d68", background: "#fff8f2" },
  "living room": { border: "#b76d68", background: "#fff8f2" },
  "poetry nook": { border: "#77578f", background: "#faf7ff" },
  "reading room": { border: "#486532", background: "#f7fce8" },
  library: { border: "#486532", background: "#f7fce8" },
  "family gallery": { border: "#3979aa", background: "#eff6ff" },
};

const roomPaths: Record<string, string> = {
  "tv room": "/tv",
  "movie theater": "/movies",
  "home theater": "/movies",
  "music salon": "/music",
  "music room": "/music",
  "the kitchen": "/foodies",
  blogs: "/blogs",
  "family blog": "/blogs",
  "living room": "/blogs",
  "poetry nook": "/poetry",
  "reading room": "/books",
  library: "/books",
  "family gallery": "/family-gallery",
  "family discussions": "/threads",
};

function dashboardRows(rows: { label: string; actionType: string; count: number }[]): DashboardRow[] {
  const grouped = new Map<string, DashboardRow>();
  for (const row of rows) {
    const entry = grouped.get(row.label) ?? {
      label: row.label,
      POST_CREATED: 0,
      COMMENT_CREATED: 0,
      REACTION_ADDED: 0,
    };
    if (row.actionType === "POST_CREATED") entry.POST_CREATED += row.count;
    if (row.actionType === "COMMENT_CREATED") entry.COMMENT_CREATED += row.count;
    if (row.actionType === "LIKE_ADDED" || row.actionType === "LOVE_ADDED") entry.REACTION_ADDED += row.count;
    grouped.set(row.label, entry);
  }
  return [...grouped.values()];
}

function rowTotal(row: DashboardRow): number {
  return row.POST_CREATED + row.COMMENT_CREATED + row.REACTION_ADDED;
}

function memberDashboardRows(rows: DashboardRow[]): DashboardRow[] {
  const sorted = [...rows].sort((left, right) => rowTotal(right) - rowTotal(left) || left.label.localeCompare(right.label));
  const visible = sorted.slice(0, 4);
  const others = sorted.slice(4);
  if (others.length) {
    visible.push(others.reduce((total, row) => ({
      label: "Others",
      POST_CREATED: total.POST_CREATED + row.POST_CREATED,
      COMMENT_CREATED: total.COMMENT_CREATED + row.COMMENT_CREATED,
      REACTION_ADDED: total.REACTION_ADDED + row.REACTION_ADDED,
    }), { label: "Others", POST_CREATED: 0, COMMENT_CREATED: 0, REACTION_ADDED: 0 }));
  }
  return visible;
}

function ActivityChart({ title, rows }: { title: string; rows: DashboardRow[] }) {
  const maxTotal = Math.max(0, ...rows.map(rowTotal));
  return (
    <Section style={{ marginBottom: "18px" }}>
      <Heading as="h3" style={{ color: "#1e3a8a", fontSize: "16px", margin: "16px 0 10px" }}>{title}</Heading>
      <table role="presentation" style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {rows.length ? rows.map((row) => {
            const total = rowTotal(row);
            const values = [
              { value: row.POST_CREATED, color: chartSegments[0].color },
              { value: row.COMMENT_CREATED, color: chartSegments[1].color },
              { value: row.REACTION_ADDED, color: chartSegments[2].color },
            ];
            const remainder = maxTotal - total;
            return (
              <tr key={row.label}>
                <td style={{ color: "#334155", fontSize: "12px", padding: "5px 8px 5px 0", width: "30%" }}>{row.label}</td>
                <td style={{ padding: "5px 0", width: "60%" }}>
                  <table role="presentation" style={{ borderCollapse: "collapse", height: "14px", tableLayout: "fixed", width: "100%" }}>
                    <tbody><tr>
                      {values.map(({ value, color }, index) => value > 0 ? (
                        <td key={index} style={{ backgroundColor: color, height: "14px", width: `${(value / maxTotal) * 100}%` }} />
                      ) : null)}
                      {remainder > 0 ? <td style={{ backgroundColor: "#f1f5f9", height: "14px", width: `${(remainder / maxTotal) * 100}%` }} /> : null}
                    </tr></tbody>
                  </table>
                </td>
                <td style={{ color: "#64748b", fontSize: "11px", padding: "5px 0 5px 8px", textAlign: "right", width: "10%" }}>{total}</td>
              </tr>
            );
          }) : (
            <tr><td style={{ color: "#64748b", fontSize: "13px", padding: "8px 0" }}>No activity to chart this week.</td></tr>
          )}
        </tbody>
      </table>
    </Section>
  );
}

const actionLabel = (actionType: string) => ({
  POST_CREATED: "New post",
  ALBUM_SHARED: "Shared album",
  DISCUSS_START: "Started discussion",
}[actionType] ?? actionType.toLowerCase().replaceAll("_", " "));

const EXCERPT_MAX_LENGTH = 280;

function truncateExcerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= EXCERPT_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, EXCERPT_MAX_LENGTH - 1).replace(/\s+\S*$/, "")}…`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatDigestDate(value: string) {
  return `${value.slice(5, 7)}-${value.slice(8, 10)}-${value.slice(2, 4)}`;
}

function PostCounts({ post, color }: { post: DigestHighlightPost; color: string }) {
  const counts = [
    { label: "like", icon: "👍", value: post.likeCount },
    { label: "love", icon: "❤", value: post.loveCount },
    { label: "comment", icon: "💬", value: post.commentCount },
  ].filter((count) => count.value > 0);
  if (!counts.length) return null;
  return (
    <Text style={{ color, fontSize: "12px", margin: "6px 0 0", whiteSpace: "nowrap" }}>
      {counts.map((count) => (
        <span key={count.label} title={`${count.value} ${count.label}${count.value === 1 ? "" : "s"}`} style={{ marginRight: "8px" }}>
          {count.icon} {count.value}
        </span>
      ))}
    </Text>
  );
}

function PostCard({ entry, siteUrl }: { entry: DigestHighlight; siteUrl: string }) {
  const colors = roomColors[entry.featureName.toLowerCase()] ?? { border: "#3979aa", background: "#f8fbff" };
  const roomPath = roomPaths[entry.featureName.toLowerCase()];
  const roomUrl = roomPath ? new URL(roomPath, siteUrl).toString() : siteUrl;
  const post = entry.post;
  const imageUrl = post?.imageUrl ?? null;
  const tags = post?.tags ?? [];
  return (
    <Section style={{
      backgroundColor: colors.background,
      border: `1px solid ${colors.border}`,
      marginBottom: "10px",
      padding: "12px 14px",
    }}>
      <table role="presentation" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
        <tbody><tr>
            <td style={{ paddingRight: "16px", verticalAlign: "top", width: "120px" }}>
              {imageUrl ? (
                <Img src={imageUrl} alt={entry.postName} width="120" style={{ border: "0", display: "block", height: "auto", maxWidth: "120px" }} />
              ) : tags.length > 0 ? (
                <div style={{ width: "120px" }}>
                  {tags.map((tag) => (
                    <span key={tag} style={{
                      backgroundColor: "#ffffff", border: `1px solid ${colors.border}`, borderRadius: "4px",
                      color: colors.border, display: "inline-block", fontSize: "12px", lineHeight: "18px",
                      margin: "0 4px 4px 0", maxWidth: "108px", overflowWrap: "anywhere", padding: "3px 5px",
                    }}>{tag}</span>
                  ))}
                </div>
              ) : null}
            </td>
          <td style={{ verticalAlign: "top" }}>
            <table role="presentation" style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%" }}>
              <tbody><tr>
                <td style={{ paddingRight: post?.excerpt ? "12px" : "0", verticalAlign: "top", width: post?.excerpt ? "45%" : "100%" }}>
            <Text style={{ color: colors.border, fontSize: "12px", fontWeight: "bold", margin: "0 0 6px" }}>
              {entry.featureName} · {actionLabel(entry.actionType)}
            </Text>
            <table role="presentation" style={{ borderCollapse: "collapse" }}>
              <tbody><tr>
                <td style={{ paddingRight: "8px", verticalAlign: "middle", width: "28px" }}>
                  {entry.memberImageUrl ? (
                    <Img src={entry.memberImageUrl} alt={entry.memberName} width="28" height="28" style={{ borderRadius: "14px", display: "block" }} />
                  ) : (
                    <div style={{
                      backgroundColor: colors.border, borderRadius: "14px", color: "#ffffff", fontSize: "11px",
                      fontWeight: "bold", height: "28px", lineHeight: "28px", textAlign: "center", width: "28px",
                    }}>{initials(entry.memberName)}</div>
                  )}
                </td>
                <td style={{ verticalAlign: "middle" }}>
                  <Link href={roomUrl} style={{ color: "#1f2937", fontSize: "16px", fontWeight: "bold", textDecoration: "underline" }}>
                    {entry.postName}
                  </Link>
                </td>
              </tr></tbody>
            </table>
              <Text style={{ color: "#475569", fontSize: "12px", lineHeight: "16px", margin: "6px 0 0", overflowWrap: "anywhere" }}>{entry.memberName}</Text>
              {post ? <PostCounts post={post} color={colors.border} /> : null}
                </td>
            {post?.excerpt ? (
                <td style={{ verticalAlign: "top" }}>
                  <div style={{ maxHeight: "144px", overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 8 }}>
                    <Text style={{ color: "#334155", fontSize: "13px", lineHeight: "18px", margin: "0", overflowWrap: "anywhere" }}>{truncateExcerpt(post.excerpt)}</Text>
                  </div>
                </td>
            ) : null}
              </tr></tbody>
            </table>
          </td>
        </tr></tbody>
      </table>
    </Section>
  );
}

export default function WeeklyActivityDigestEmail({ digest, displayName, siteUrl, imageBaseUrl = siteUrl }: {
  digest: DigestActivity; displayName: string; siteUrl: string; imageBaseUrl?: string;
}) {
  const featureRows = dashboardRows(digest.featureDashboard.map((row) => ({
    label: row.featureName,
    actionType: row.actionType,
    count: row.count,
  })));
  const memberRows = memberDashboardRows(dashboardRows(digest.memberDashboard.map((row) => ({
    label: row.memberName,
    actionType: row.actionType,
    count: row.count,
  }))));

  return (
    <Html>
      <Head />
      <Preview>See what your family shared this week.</Preview>
      <Body style={{ backgroundColor: "#eff6ff", color: "#1e3a8a", fontFamily: "Arial, sans-serif", margin: 0 }}>
        <Container style={{ backgroundColor: "#ffffff", margin: "0 auto", maxWidth: "600px", padding: "24px" }}>
          <Section style={{ textAlign: "center" }}>
            <Img src={`${imageBaseUrl.replace(/\/$/, "")}/images/pwa-phone-logo-192.png`} alt="My Family Social" height="72" width="72" style={{ margin: "0 auto" }} />
            <Heading style={{ color: "#1e3a8a", fontSize: "28px", margin: "10px 0" }}>Weekly Activity</Heading>
          </Section>
          <Text style={{ color: "#334155", fontSize: "15px" }}>Hello {displayName}! Here is what your family has been doing in My Family Social this week ({formatDigestDate(digest.weekStartUtc)} to {formatDigestDate(digest.weekEndUtc)}).</Text>

          <Heading as="h2" style={{ color: "#1e3a8a", fontSize: "22px", margin: "24px 0 12px" }}>New Posts</Heading>
          {digest.highlights.length ? digest.highlights.map((entry, index) => (
            <PostCard key={`${entry.memberName}-${entry.postName}-${index}`} entry={entry} siteUrl={siteUrl} />
          )) : <Text style={{ color: "#64748b" }}>No new posts were shared this week.</Text>}

          {digest.newMembers.length > 0 ? (
            <Section>
              <Heading as="h2" style={{ color: "#1e3a8a", fontSize: "22px", margin: "26px 0 10px" }}>New Members</Heading>
              {digest.newMembers.map((member) => (
                <Section key={member.memberId} style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe", marginBottom: "10px", padding: "12px 14px" }}>
                  <table role="presentation" style={{ borderCollapse: "collapse", width: "100%" }}>
                    <tbody><tr>
                      <td style={{ paddingRight: "12px", verticalAlign: "middle", width: "48px" }}>
                        {member.memberImageUrl ? (
                          <Img src={member.memberImageUrl} alt={member.memberName} width="48" height="48" style={{ borderRadius: "24px", display: "block" }} />
                        ) : (
                          <div style={{ backgroundColor: "#3478c8", borderRadius: "24px", color: "#ffffff", fontSize: "16px", fontWeight: "bold", height: "48px", lineHeight: "48px", textAlign: "center", width: "48px" }}>{initials(member.memberName)}</div>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <Text style={{ color: "#1e3a8a", fontSize: "16px", fontWeight: "bold", margin: "0" }}>{member.memberName}</Text>
                        <Text style={{ color: "#475569", fontSize: "13px", margin: "2px 0 0" }}>Joined the family this week. Welcome!</Text>
                      </td>
                    </tr></tbody>
                  </table>
                </Section>
              ))}
            </Section>
          ) : null}

          <Heading as="h2" style={{ color: "#1e3a8a", fontSize: "22px", margin: "26px 0 10px" }}>Family Dashboards</Heading>
          <Section style={{ marginBottom: "10px" }}>
            {chartSegments.map((segment) => (
              <Text key={segment.key} style={{ color: "#475569", display: "inline-block", fontSize: "11px", margin: "0 12px 8px 0" }}>
                <span style={{ backgroundColor: segment.color, display: "inline-block", height: "9px", marginRight: "5px", width: "9px" }} />{segment.label}
              </Text>
            ))}
          </Section>
          <ActivityChart title="By Room: Posts, Comments, Reactions" rows={featureRows} />
          <ActivityChart title="By Member: Posts, Comments, Reactions" rows={memberRows} />

          <Hr style={{ borderColor: "#dbeafe", margin: "22px 0 12px" }} />
          <Text style={{ color: "#64748b", fontSize: "12px" }}>You receive this email because Activity Summary is selected in your member notification settings. Sign in to change that preference.</Text>
          <Button href={siteUrl} style={{
            backgroundColor: "#3478c8",
            borderRadius: "3px",
            color: "#ffffff",
            display: "block",
            fontSize: "17px",
            margin: "20px auto 4px",
            padding: "15px 24px",
            textAlign: "center",
          }}>Visit My Family Social</Button>
        </Container>
      </Body>
    </Html>
  );
}
