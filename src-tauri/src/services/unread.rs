/// Maximum badge value. A malicious or broken page cannot overflow the UI.
pub const MAX_BADGE: u32 = 999;

/// Extracts an unread count from a document title.
///
/// Web apps expose counts in a handful of common shapes:
/// `(12) WhatsApp`, `Telegram (3)`, `[7] Slack`, and `4 unread`.
/// We keep the parser conservative so years, codes and phone numbers are not
/// mistaken for notifications.
pub fn parse_unread(title: &str) -> u32 {
    let title = title.trim();
    if title.is_empty() {
        return 0;
    }

    // Leading parenthesized count: "(12) WhatsApp".
    if let Some(rest) = title.strip_prefix('(') {
        if let Some((number, tail)) = rest.split_once(')') {
            if tail.starts_with(char::is_whitespace) {
                if let Some(count) = parse_bounded(number) {
                    return count;
                }
            }
        }
    }

    // Leading bracketed count: "[7] Slack".
    if let Some(rest) = title.strip_prefix('[') {
        if let Some((number, tail)) = rest.split_once(']') {
            if tail.starts_with(char::is_whitespace) {
                if let Some(count) = parse_bounded(number) {
                    return count;
                }
            }
        }
    }

    // Trailing parenthesized count: "Telegram (3)".
    if title.ends_with(')') {
        if let Some(open) = title.rfind('(') {
            let number = &title[open + 1..title.len() - 1];
            let prefix = title[..open].trim_end();
            if !prefix.is_empty() {
                if let Some(count) = parse_bounded(number) {
                    return count;
                }
            }
        }
    }

    // Explicit unread phrase: "4 unread" or "4 new messages".
    let lower = title.to_ascii_lowercase();
    for marker in [" unread", " new messages", " new message"] {
        if let Some(index) = lower.find(marker) {
            let prefix = &lower[..index];
            let number = prefix.split_whitespace().last().unwrap_or_default();
            if let Some(count) = parse_bounded(number) {
                return count;
            }
        }
    }

    0
}

/// Parses a numeric count and rejects implausible values.
///
/// Digit runs longer than nine characters are rejected so phone numbers and
/// long identifiers inside titles can never become a badge. Values above
/// [`MAX_BADGE`] are rejected rather than clamped: web apps put years in titles
/// (`(2026) Year in review`), and clamping turned those into a permanent 999
/// badge. Real unread counters stay far below that ceiling.
fn parse_bounded(raw: &str) -> Option<u32> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 9 || !raw.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let count = raw.parse::<u32>().ok()?;
    (count <= MAX_BADGE).then_some(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Covers the title formats used by the supported services.
    #[test]
    fn parses_common_title_shapes() {
        assert_eq!(parse_unread("(12) WhatsApp"), 12);
        assert_eq!(parse_unread("Telegram (3)"), 3);
        assert_eq!(parse_unread("[7] Slack | general"), 7);
        assert_eq!(parse_unread("Discord — 9 unread"), 9);
        assert_eq!(parse_unread("(0) Messenger"), 0);
    }

    /// Titles without notification counts stay at zero.
    #[test]
    fn ignores_ordinary_titles() {
        assert_eq!(parse_unread("WhatsApp"), 0);
        assert_eq!(parse_unread("(2026) Year in review"), 0); // a year is not a count
        assert_eq!(parse_unread("Chat 0812 3456 7890"), 0);
        assert_eq!(parse_unread("(081234567890) Partner"), 0); // phone numbers are not badges
        assert_eq!(parse_unread("X"), 0);
    }

    /// Values beyond the badge ceiling are ignored instead of clamped.
    #[test]
    fn rejects_implausible_values() {
        assert_eq!(parse_unread("(99999) Overflow"), 0);
        assert_eq!(parse_unread("(2026) Notifications"), 0);
        assert_eq!(parse_unread("(100) Big"), 100);
        assert_eq!(parse_unread("(999) Edge"), 999);
    }
}
