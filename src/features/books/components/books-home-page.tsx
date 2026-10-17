"use client";

import type { JSONContent } from "@tiptap/core";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { useEditor } from "@tiptap/react";
import {
  Eye,
  Heart,
  HouseHeart,
  LibraryBig,
  MessageSquare,
  NotebookPen,
  PenSquare,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { clearQueuedFeatureComment, createClientRequestId, getPwaSyncNowEventName, isBrowserOnline, queueFeatureComment, readQueuedFeatureComments } from "@/lib/pwa-background-sync";

import {
  addBookCommentAction,
  toggleBookReactionAction,
  deleteBooksHomeBookAction,
} from "@/app/(features)/(books)/books/actions";
import MemberAvatar from "@/components/common/member-avatar";
import {
  createEmptyTipTapDocument,
  isSerializedTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from "@/components/db/types/poem-term-validation";
import { BookTagOption, BooksHomeBook } from "@/components/db/types/books";
import type { BiblioMemberOption, BookReviewPrefill } from "@/components/db/types/book-biblio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemberKeyDetails } from "@/features/family/types/family-steps";
import FeatureFaqHelp from "@/components/common/feature-faq-help";
import EditPostIcon from "@/components/common/edit-post-icon";
import {
  FilterSidebar,
  FilterSidebarCheckbox,
  FilterSidebarDateScope,
  FilterSidebarGroup,
  FilterSidebarProvider,
  FilterSidebarRadio,
  FilterSidebarSearch,
  FilterSidebarTrigger,
  type FilterSidebarPalette,
} from "@/components/common/filter-sidebar";

const booksFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#f8fcff",
  sidebarForeground: "#183746",
  sidebarBorder: "#d9e5ea",
  label: "#3d819b",
  muted: "#51707e",
  inputBorder: "#c8d7df",
  inputText: "#183746",
  chipBorder: "#c8d7df",
  chipText: "#183746",
  chipHoverBackground: "#f3f9fc",
  checkBorder: "#9ec3d2",
  checkboxText: "#2a5a6f",
  accent: "#0f5c78",
  accentHoverBackground: "#0a4860",
  triggerBorder: "#c9e2ec",
  triggerBackground: "#f6fbfe",
  triggerText: "#183746",
  triggerHoverBackground: "#dff2f9",
};
import {
  createDraftFromBook,
  createEmptyDraft,
  useBookDialog,
} from "@/features/books/hooks/use-book-dialog";
import { useLinkDialog } from "@/features/books/hooks/use-link-dialog";
import { BookDetailsDialog } from "@/features/books/components/dialogs/book-details-dialog";
import { BookLinkDialog } from "@/features/books/components/dialogs/book-link-dialog";
type DirectoryMode = "all" | "latest" | "top-rated";

function getEditorDocument(value?: string): JSONContent {
  const parsed = parseSerializedTipTapDocument(value);

  if (parsed.success) {
    return parsed.content;
  }

  return createEmptyTipTapDocument();
}

function formatCreatedAt(createdAt: Date) {
  const date = new Date(createdAt);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${ month }-${ day }-${ year }`;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ year }-${ month }-${ day }`;
}

export default function BooksHomePage({
  books,
  member,
  bookTags = [],
  biblioMembers = [],
  reviewPrefill = null,
  loadError = null,
}: {
  books: BooksHomeBook[];
  member: MemberKeyDetails;
  bookTags?: BookTagOption[];
  biblioMembers?: BiblioMemberOption[];
  reviewPrefill?: BookReviewPrefill | null;
  loadError?: string | null;
}) {
  const router = useRouter();
  const previousBooksRef = useRef(books);
  const [isEngaging, startEngageTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [biblioSearchValue, setBiblioSearchValue] = useState("");
  const [bookItems, setBookItems] = useState(() => books.map((bookRecord) => createDraftFromBook(bookRecord, member)));
  const [selectedBookId, setSelectedBookId] = useState<number | null>(books.find((bookRecord) => bookRecord.status === "published")?.id ?? books[0]?.id ?? null);
  const [pendingSelectedBookId, setPendingSelectedBookId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterWithClubSessions, setFilterWithClubSessions] = useState(false);
  const [expandBookCards, setExpandBookCards] = useState(true);
  const [directoryMode, setDirectoryMode] = useState<DirectoryMode>("all");
  const [dateScope, setDateScope] = useState<"everything" | "date-range">("everything");
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return toDateInputValue(threeMonthsAgo);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [appliedStartDate, setAppliedStartDate] = useState(startDate);
  const [appliedEndDate, setAppliedEndDate] = useState(endDate);
  const deferredSearchValue = useDeferredValue(searchValue);
  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;
  const initialDraft = useMemo(() => {
    if (reviewPrefill) {
      return {
        ...createEmptyDraft(member),
        bookTitle: reviewPrefill.bookTitle,
        authorName: reviewPrefill.authorName,
        bookSeriesName: reviewPrefill.bookSeriesName,
        bookYear: reviewPrefill.bookYear ? String(reviewPrefill.bookYear) : "",
        analysisJson: reviewPrefill.analysisJson,
        selectedTagIds: reviewPrefill.selectedTagIds,
      };
    }

    if (books[0]) {
      return createDraftFromBook(books[0], member);
    }

    return createEmptyDraft(member);
  }, [books, member, reviewPrefill]);

  const selectedBook = bookItems.find((bookItem) => bookItem.id === selectedBookId) ?? null;
  const canEditSelected = selectedBook
    ? selectedBook.memberId === member.memberId || member.isFounder
    : false;

  const bookDialog = useBookDialog({
    initialDraft,
    initialDialogMode: reviewPrefill ? "add" : "view",
    initialIsDialogOpen: Boolean(reviewPrefill),
    member,
    selectedBook,
    canEditSelected,
    onBookSaved(savedBook) {
      setPendingSelectedBookId(savedBook.id);
      setSelectedBookId(savedBook.id);

      if (reviewPrefill) {
        router.replace("/books");
      }
    },
  });

  const draft = bookDialog.draft;
  const { setDraft } = bookDialog;
  const { markSaveSynced } = bookDialog;

  const analysisEditor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
      }),
    ],
    content: getEditorDocument(draft.analysisJson),
    editable: bookDialog.bookDialogMode !== "view",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-[12rem]",
      },
    },
    onUpdate({ editor }) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        analysisJson: serializeTipTapDocument(editor.getJSON()),
      }));
    },
  });

  useEffect(() => {
    if (!analysisEditor) {
      return;
    }

    analysisEditor.setEditable(bookDialog.bookDialogMode !== "view");
  }, [analysisEditor, bookDialog.bookDialogMode]);

  useEffect(() => {
    if (!analysisEditor) {
      return;
    }

    const editorJson = serializeTipTapDocument(analysisEditor.getJSON());

    if (editorJson !== draft.analysisJson) {
      analysisEditor.commands.setContent(getEditorDocument(draft.analysisJson));
    }
  }, [analysisEditor, draft.analysisJson, draft.id]);

  useEffect(() => {
    const nextBookItems = books.map((bookRecord) => createDraftFromBook(bookRecord, member));
    const resolvedSelectedBookId = pendingSelectedBookId
      && nextBookItems.some((bookItem) => bookItem.id === pendingSelectedBookId)
      ? pendingSelectedBookId
      : selectedBookId;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookItems(nextBookItems);
    setSelectedBookId((currentSelectedBookId) => {
      const preferredBookId = resolvedSelectedBookId ?? currentSelectedBookId;

      if (preferredBookId && nextBookItems.some((bookItem) => bookItem.id === preferredBookId)) {
        return preferredBookId;
      }

      return nextBookItems[0]?.id ?? null;
    });

    const receivedRefreshedBooks = previousBooksRef.current !== books;

    if (receivedRefreshedBooks && pendingSelectedBookId && nextBookItems.some((bookItem) => bookItem.id === pendingSelectedBookId)) {
      setPendingSelectedBookId(null);
      markSaveSynced();
    }

    previousBooksRef.current = books;
  }, [books, member, pendingSelectedBookId, selectedBookId, markSaveSynced]);

  const linkDialog = useLinkDialog(analysisEditor);

  const visibleBookItems = useMemo(() => (
    bookItems.filter((bookItem) => {
      const normalizedStatus = bookItem.status.trim().toLowerCase();

      return (
        normalizedStatus === "published"
        || (normalizedStatus === "draft" && (bookItem.memberId === member.memberId || member.isFounder))
        || (includeArchived && normalizedStatus === "archived")
      );
    })
  ), [bookItems, includeArchived, member.isFounder, member.memberId]);

  const directoryBooks = useMemo(() => {
    const scopedBookItems = visibleBookItems.filter((bookItem) => {
      const createdAt = new Date(bookItem.createdAt);

      if (startDateValue && createdAt < startDateValue) {
        return false;
      }

      if (endDateValue && createdAt > endDateValue) {
        return false;
      }

      return true;
    });

    if (directoryMode === "all") {
      return [...scopedBookItems].sort((leftBook, rightBook) => (
        leftBook.bookTitle.localeCompare(rightBook.bookTitle, undefined, { sensitivity: "base" })
      ));
    }

    if (directoryMode === "latest") {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

      return scopedBookItems
        .filter((bookItem) => new Date(bookItem.createdAt).getTime() >= twoMonthsAgo.getTime())
        .sort((leftBook, rightBook) => (
          new Date(rightBook.createdAt).getTime() - new Date(leftBook.createdAt).getTime()
        ))
        .slice(0, 8);
    }

    return scopedBookItems
      .filter((bookItem) => (bookItem.likeCount + bookItem.loveCount) > 0)
      .sort((leftBook, rightBook) => {
        const rightScore = rightBook.likeCount + rightBook.loveCount;
        const leftScore = leftBook.likeCount + leftBook.loveCount;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return new Date(rightBook.createdAt).getTime() - new Date(leftBook.createdAt).getTime();
      })
      .slice(0, 8);
  }, [directoryMode, endDateValue, startDateValue, visibleBookItems]);

  const filteredBooks = useMemo(() => {
    const normalizedQuery = deferredSearchValue.trim().toLowerCase();
    const booksWithFilter = filterWithClubSessions
      ? directoryBooks.filter((bookItem) => bookItem.hasClubSession)
      : directoryBooks;

    if (!normalizedQuery) {
      return booksWithFilter;
    }

    return booksWithFilter.filter((bookItem) => (
      bookItem.bookTitle.toLowerCase().includes(normalizedQuery)
      || bookItem.authorName.toLowerCase().includes(normalizedQuery)
      || bookItem.bookYear.toLowerCase().includes(normalizedQuery)
      || bookItem.bookLanguage.toLowerCase().includes(normalizedQuery)
      || (bookItem.bookSeriesName ?? "").toLowerCase().includes(normalizedQuery)
      || bookItem.submitterName.toLowerCase().includes(normalizedQuery)
    ));
  }, [deferredSearchValue, directoryBooks, filterWithClubSessions]);

  const activeBookTags = useMemo(() => (
    bookTags.filter((tagOption) => tagOption.status !== "archived")
  ), [bookTags]);

  useEffect(() => {
    if (filteredBooks.length === 0) {
      return;
    }

    if (selectedBookId && filteredBooks.some((bookItem) => bookItem.id === selectedBookId)) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedBookId(filteredBooks[0].id);
  }, [filteredBooks, selectedBookId]);

  const selectedBookTags = useMemo(() => {
    if (!selectedBook) {
      return [] as BookTagOption[];
    }

    return bookTags.filter((tagOption) => selectedBook.selectedTagIds.includes(tagOption.id));
  }, [bookTags, selectedBook]);

  function handleSelectBook(bookId: number) {
    setCommentText("");
    setSelectedBookId(bookId);
  }

  function handleOpenBookFromCard(bookId: number) {
    handleSelectBook(bookId);
    setTimeout(() => {
      bookDialog.openBookDialog("view");
    }, 0);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function applyBookRefresh(updatedBook: BooksHomeBook) {
    const updatedDraft = createDraftFromBook(updatedBook, member);

    setBookItems((currentBooks) => currentBooks.map((bookItem) => (
      bookItem.id === updatedDraft.id ? updatedDraft : bookItem
    )));
    setSelectedBookId(updatedDraft.id);

    if (draft.id === updatedDraft.id) {
      setDraft(updatedDraft);
    }
  }

  useEffect(() => {
    const flushQueuedBookComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFeatureComments().filter((item) => item.kind === "book");

      for (const queuedComment of queuedComments) {
        const result = await addBookCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFeatureComment(queuedComment.payload.clientRequestId);
        }

        applyBookRefresh(result.book);
      }
    };

    void flushQueuedBookComments();

    const handleSync = () => {
      void flushQueuedBookComments();
    };

    window.addEventListener("online", handleSync);
    window.addEventListener(getPwaSyncNowEventName(), handleSync);

    return () => {
      window.removeEventListener("online", handleSync);
      window.removeEventListener(getPwaSyncNowEventName(), handleSync);
    };
  }, [member, draft.id]);

  function handleToggleReaction(reactionType: -1 | 1 | 2) {
    if (!selectedBook) {
      return;
    }

    if (!bookDialog.isBookDialogOpen || bookDialog.bookDialogMode !== "view") {
      toast.error("Open View Book before posting a reaction.");
      return;
    }

    startEngageTransition(async () => {
      const result = await toggleBookReactionAction({
        bookId: selectedBook.id,
        reactionType,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      applyBookRefresh(result.book);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedBook) {
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);

    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const payload = {
        bookId: selectedBook.id,
        commentText: normalizedComment,
        clientRequestId: createClientRequestId("book-comment"),
      };
      const result = await addBookCommentAction(payload);

      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFeatureComment({
            kind: "book",
            payload,
            itemTitle: selectedBook.bookTitle,
            commenterName: `${ member.firstName } ${ member.lastName }`.trim(),
            queuedAt: new Date().toISOString(),
          });
          setCommentText("");
          toast.message("Comment saved locally. It will sync when you are back online.");
          return;
        }

        toast.error(result.message);
        return;
      }

      applyBookRefresh(result.book);
      setCommentText("");
      toast.success(result.message);
    });
  }

  function handleDelete() {
    if (!selectedBook?.id) {
      return;
    }

    const deletedBookId = selectedBook.id;

    startDeleteTransition(async () => {
      const result = await deleteBooksHomeBookAction({ bookId: deletedBookId });
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      const remainingBooks = bookItems.filter((bookItem) => bookItem.id !== deletedBookId);

      setBookItems(remainingBooks);
      setSelectedBookId((currentSelectedBookId) => {
        if (currentSelectedBookId && remainingBooks.some((bookItem) => bookItem.id === currentSelectedBookId)) {
          return currentSelectedBookId;
        }

        return remainingBooks[0]?.id ?? null;
      });
      setPendingSelectedBookId(null);
      setCommentText("");
      bookDialog.setIsBookDialogOpen(false);

      toast.success("Book deleted.");
      router.push("/books");
    });
  }

  /*---------------------------------------- Main Return ----------------------------------------------- */
  return (
    <FilterSidebarProvider palette={ booksFilterPalette }>
      <FilterSidebar title="Book Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by title, author, year, language, series, or family member"
          ariaLabel="Search books"
        />
        <FilterSidebarDateScope
          radioName="book-date-scope"
          dateScope={ dateScope }
          onDateScopeChange={ setDateScope }
          startDate={ startDate }
          endDate={ endDate }
          onStartDateChange={ setStartDate }
          onEndDateChange={ setEndDate }
          isDateRangeScope={ isDateRangeScope }
          hasPendingChanges={ hasPendingDateChanges }
          onApply={ handleApplyDateRange }
        />
        <FilterSidebarGroup label="Book Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="book-directory-mode" value="all" checked={ directoryMode === "all" } onChange={ () => setDirectoryMode("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="book-directory-mode" value="latest" checked={ directoryMode === "latest" } onChange={ () => setDirectoryMode("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="book-directory-mode" value="top-rated" checked={ directoryMode === "top-rated" } onChange={ () => setDirectoryMode("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived Too</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithClubSessions } onChange={ setFilterWithClubSessions }>Clubs Only</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ expandBookCards } onChange={ setExpandBookCards }>Expand Book Cards</FilterSidebarCheckbox>
        </FilterSidebarGroup>
        <FilterSidebarGroup label="Family Bibliographies" className="space-y-3">
          <select
            aria-label="Open a family member's bibliography"
            value=""
            disabled={ biblioMembers.length === 0 }
            onChange={ (event) => {
              if (event.target.value) {
                router.push(`/member-books/${ event.target.value }`);
              }
            } }
            className="h-9 w-full rounded-full border border-(--ffs-input-border) bg-white px-3 text-xs text-(--ffs-input-text) shadow-sm disabled:opacity-60 sm:h-10 sm:text-sm"
          >
            <option value="">
              { biblioMembers.length === 0 ? "No family bibliographies yet" : "Select a family member..." }
            </option>
            { biblioMembers.map((biblioMember) => (
              <option key={ biblioMember.memberId } value={ String(biblioMember.memberId) }>
                { biblioMember.firstName } { biblioMember.lastName } ({ biblioMember.entryCount })
              </option>
            )) }
          </select>

          <form action="/member-books/search" className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--ffs-muted)" />
            <Input
              name="q"
              type="search"
              value={ biblioSearchValue }
              onChange={ (event) => setBiblioSearchValue(event.target.value) }
              placeholder="Book title or author"
              aria-label="Search family bibliographies"
              className="h-9 w-full rounded-full border-(--ffs-input-border) bg-white pl-10 pr-3 text-xs text-(--ffs-input-text) shadow-sm sm:h-10 sm:text-sm"
            />
          </form>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app min-w-0 flex-1 px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(9,56,82,0.96),rgba(30,115,142,0.9)_52%,rgba(217,171,103,0.82))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(6,34,52,0.95)] sm:px-8 sm:py-8 lg:px-10">
          <div className="flex flex-col gap-3 sm:gap-5">
            <div className="max-w-4xl">
              <p className="text-[1rem] font-bold uppercase tracking-[0.34em] text-[#d9f3ff]">
                Family Library
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ecfaff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <HouseHeart className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  Go Home
                </Link>
                <Link
                  href="/member-books"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ecfaff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <NotebookPen className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  My Books
                </Link>
                <Link
                  href="/book-terms"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ecfaff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <LibraryBig className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  Tags & Terms
                </Link>
                  <Link
                    href="/add-club?from=books"
                    className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ecfaff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                  >
                    <UsersRound className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                    Clubs
                  </Link>
              </div>

              {/* <h1 className="mt-3 text-base font-black leading-snug tracking-tight sm:mt-4 sm:text-2xl">
                Post a book review and discuss it with other members of the family!
              </h1> */}
            </div>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-40px_rgba(9,56,82,0.7)] backdrop-blur">
          <div className="border-b border-[#d9e5ea] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,250,252,0.86))] px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#42748a]">Book Directory</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#51707e]">
                  <h2 className="text-2xl font-black tracking-tight text-[#183746]">Select a Book Submission</h2>
                  <FeatureFaqHelp
                    href=" /feature-faq?category=Library"
                    buttonClassName="h-4 w-4 md:h-7 md:w-7 border-[#9dd8f0] bg-gradient-to-b from-[#f4fcff] to-[#d9f2ff] text-[#1d6d8f] shadow-[0_8px_18px_rgba(29,109,143,0.2)] group-hover:shadow-[0_12px_26px_rgba(29,109,143,0.3)]"
                    iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#1d6d8f]"
                    tooltipClassName="bg-[#0f435c] text-[#ecfaff]"
                  />
                  <EditPostIcon tooltip="Filter Books" tooltipClassName="bg-[#0f435c] text-[#ecfaff]">
                    <FilterSidebarTrigger ariaLabel="Toggle book filters" />
                  </EditPostIcon>
                  <EditPostIcon tooltip="View Book" tooltipClassName="bg-[#0f435c] text-[#ecfaff]">
                    <Button
                      type="button"
                      onClick={ () => bookDialog.openBookDialog("view") }
                      disabled={ !selectedBook }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#183746] hover:bg-[#dff2f9] disabled:opacity-50 sm:px-3"
                      aria-label="View selected book"
                    >
                      <Eye className="size-3.5" />
                      <span className="hidden sm:inline">View</span>
                    </Button>
                  </EditPostIcon>
                  <EditPostIcon tooltip="Edit Book" tooltipClassName="bg-[#0f435c] text-[#ecfaff]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={ () => bookDialog.openBookDialog("edit") }
                      disabled={ !selectedBook || !canEditSelected }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#183746] hover:bg-[#dff2f9] hover:text-[#183746] disabled:opacity-50 sm:px-3"
                      aria-label="Edit selected book"
                    >
                      <PenSquare className="size-3.5" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                  </EditPostIcon>
                  <EditPostIcon tooltip="Add Book" tooltipClassName="bg-[#0f435c] text-[#ecfaff]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={ () => bookDialog.openBookDialog("add") }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#183746] hover:bg-[#dff2f9] hover:text-[#183746] sm:px-3"
                      aria-label="Add book"
                    >
                      <Plus className="size-3.5" />
                      <span className="hidden sm:inline">Add</span>
                    </Button>
                  </EditPostIcon>
                </div>
                {/* <p className="mt-2 max-w-2xl text-sm leading-6 text-[#51707e]">
                  Select a book card from the directory, or use search to narrow the list, then open View Book or Edit Book details in a separate dialog.
                </p> */}
              </div>

              {/* <div className="rounded-full border border-[#d9e5ea] bg-[#f4fbff] px-4 py-2 text-sm font-semibold text-[#51707e]">
                { filteredBooks.length } visible book{ filteredBooks.length !== 1 ? "s" : "" }
              </div> */}
            </div>

          </div>

          <div className="px-5 py-5 sm:px-6">
            { bookItems.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-[#c8d7df] bg-[#f8fcff] px-6 py-10 text-center text-[#51707e]">
                <LibraryBig className="mx-auto mb-3 size-10 text-[#6f9cb0]" />
                { loadError ? (
                  <>
                    <p className="text-lg font-semibold text-[#183746]">Books could not be loaded.</p>
                    <p className="mt-2 text-sm">{ loadError }</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-[#183746]">No books have been added yet.</p>
                    <p className="mt-2 text-sm">Use Add Book to create the first submission for this family.</p>
                  </>
                ) }
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-4">
                  { filteredBooks.map((bookItem) => {
                    const isSelected = bookItem.id === selectedBookId;
                    const isAwaitingServerSync = pendingSelectedBookId === bookItem.id && bookDialog.savePhase === "saving";

                    return (
                      <button
                        key={ bookItem.id }
                        type="button"
                        onClick={ () => handleSelectBook(bookItem.id) }
                        onDoubleClick={ () => handleOpenBookFromCard(bookItem.id) }
                        className={ `grid min-w-0 w-full gap-2 rounded-[1.4rem] border px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3d819b] sm:gap-3 sm:px-4 sm:py-4 ${ isSelected
                          ? "border-[#3d819b] bg-[linear-gradient(135deg,rgba(231,247,255,0.95),rgba(248,252,255,0.95))] shadow-[0_18px_45px_-35px_rgba(9,56,82,0.7)]"
                          : "border-[#deeaef] bg-white hover:border-[#a6c6d3] hover:bg-[#fbfdff]"
                          }` }
                      >
                        <div>
                          { expandBookCards ? (
                            <div className="flex flex-wrap items-start gap-1">
                              <p className="min-w-0 wrap-break-word line-clamp-2 text-xs font-bold leading-snug text-[#183746] sm:text-sm">{ bookItem.bookTitle }</p>
                              { bookItem.hasClubSession ? (
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e4f3fa] text-[#1d6d8f]" title="Club session available">
                                  <MessageSquare className="size-3" aria-label="Club session available" />
                                </span>
                              ) : null }
                              { isAwaitingServerSync ? (
                                <span className="rounded-full bg-[#dbf1fb] px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[#2d667d]">
                                  Syncing
                                </span>
                              ) : null }
                            </div>
                          ) : (
                            <p className="min-w-0 wrap-break-word line-clamp-2 text-xs font-bold leading-snug text-[#183746] sm:text-sm">{ bookItem.bookTitle }</p>
                          ) }
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.7rem] text-[#6b8a98] sm:flex-nowrap sm:text-xs">
                            { bookItem.submitterImageUrl ? (
                              <span className="inline-flex" title={ bookItem.submitterName }>
                                <MemberAvatar imageUrl={ bookItem.submitterImageUrl } firstName={ bookItem.submitterName } sizeClassName="h-[26px] w-[26px]" />
                              </span>
                            ) : <span className="wrap-break-word font-semibold text-[#355161]">{ bookItem.submitterName }</span> }
                            <span className="whitespace-nowrap">{ formatCreatedAt(bookItem.createdAt) }</span>
                          </div>
                          { bookItem.status === "draft" ? (
                            <p className="mt-1 inline-flex w-fit rounded-full border border-[#d4a64f] bg-[#fff5dc] px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#9a5a06] sm:text-[0.65rem]">
                              Draft
                            </p>
                          ) : null }
                        </div>
                        { expandBookCards ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 sm:gap-x-2 md:gap-x-3">
                              <div className="min-w-26">
                                <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-[#5d8aa0]">Author</p>
                                <p className="text-xs font-semibold text-[#355161] sm:text-sm">{ bookItem.authorName }</p>
                              </div>
                              <div className="min-w-18">
                                <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-[#5d8aa0]">Year</p>
                                <p className="text-xs font-semibold text-[#355161] sm:text-sm">{ bookItem.bookYear || "-" }</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-1.5 md:gap-x-2">
                              <div className="inline-flex items-center gap-0.5 text-[0.65rem] font-semibold text-[#355161] sm:text-[0.7rem]">
                                <ThumbsDown className="size-2.5 text-[#5d7c8a] sm:size-3" />
                                { bookItem.dislikeCount }
                              </div>
                              <div className="inline-flex items-center gap-0.5 text-[0.65rem] font-semibold text-[#355161] sm:text-[0.7rem]">
                                <ThumbsUp className="size-2.5 text-[#1d6d8f] sm:size-3" />
                                { bookItem.likeCount }
                              </div>
                              <div className="inline-flex items-center gap-0.5 text-[0.65rem] font-semibold text-[#355161] sm:text-[0.7rem]">
                                <Heart className="size-2.5 text-[#c06c4a] sm:size-3" />
                                { bookItem.loveCount }
                              </div>
                              <div className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#355161] sm:text-xs">
                                <MessageSquare className="size-3 text-[#3d819b] sm:size-3.5" />
                                { bookItem.commentCount }
                              </div>
                            </div>
                          </div>
                        ) : null }
                      </button>
                    );
                  }) }
                </div>

                { filteredBooks.length === 0 ? (
                  <div className="mt-4 rounded-[1.3rem] border border-dashed border-[#c8d7df] bg-[#f8fcff] px-4 py-6 text-center text-sm text-[#51707e]">
                    { directoryMode === "top-rated"
                      ? "No top-rated books match this view yet."
                      : "No books match that search yet." }
                  </div>
                ) : null }
              </>
            ) }
          </div>
        </div>
      </div>

      <BookDetailsDialog
        bookDialog={ bookDialog }
        linkDialog={ linkDialog }
        analysisEditor={ analysisEditor }
        member={ member }
        tags={ {
          selectedBookTags,
          activeBookTags,
        } }
        engagement={ {
          isEngaging,
          canEngage: selectedBook?.memberId !== member.memberId,
          commentText,
          setCommentText,
          onToggleReaction: handleToggleReaction,
          onAddComment: handleAddComment,
        } }
        save={ {
          onSave: () => bookDialog.handleSave(analysisEditor ? serializeTipTapDocument(analysisEditor.getJSON()) : draft.analysisJson),
          onDelete: handleDelete,
        } }
        formatCreatedAt={ formatCreatedAt }
      />

      <BookLinkDialog linkDialog={ linkDialog } />
      </section>
    </FilterSidebarProvider>
  );
}
