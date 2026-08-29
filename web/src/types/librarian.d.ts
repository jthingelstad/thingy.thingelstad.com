// Librarian API shapes. The generated contract client
// (src/generated/librarian-contract.generated.ts, built from
// contracts/librarian-api.json) is the single source of truth; this shim only
// re-exposes the generated types under the ambient names components use and
// layers the client-only views on top.

type LibrarianProfile = import('../generated/librarian-contract.generated.ts').LibrarianProfile;
type LibrarianAccountOverview = import('../generated/librarian-contract.generated.ts').LibrarianAccountOverview;
type ThingyMode = import('../generated/librarian-contract.generated.ts').LibrarianMode;
type ThingyArchiveItem = import('../generated/librarian-contract.generated.ts').LibrarianArchiveItem;
type ThingyCitation = import('../generated/librarian-contract.generated.ts').LibrarianCitation;

// Client-side conversation summary: the generated conversation shape with a
// guaranteed id (local drafts always mint one; server rows always carry one).
type ThingyConversationSummary = import('../generated/librarian-contract.generated.ts').LibrarianConversation & {
  id: string;
};

// Client-side view of the response envelope: the generated shape with
// conversation summaries narrowed to ThingyConversationSummary.
type ThingyApiResponse = import('../generated/librarian-contract.generated.ts').LibrarianApiResponse & {
  conversations?: ThingyConversationSummary[];
  conversation?: ThingyConversationSummary;
};

// The /auth response uses the same envelope; the alias keeps auth call
// sites readable.
type ThingyAuthData = ThingyApiResponse;

// Streamed SSE payloads (every stream event shares one base in the contract).
type ThingyStreamData = import('../generated/librarian-contract.generated.ts').LibrarianStreamBase & {
  conversation?: ThingyConversationSummary;
};
