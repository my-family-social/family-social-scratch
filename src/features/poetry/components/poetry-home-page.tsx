"use client";

import type { JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import {
  HouseHeart,
  Eye,
  Heart,
  LibraryBig,
  MessageSquare,
  PenSquare,
  Plus,
  Tags,
  ThumbsDown,
  ThumbsUp,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addPoemCommentAction,
  togglePoemReactionAction,
} from "@/app/(features)/(poetry)/poetry/actions";
import MemberAvatar from "@/components/common/member-avatar";
import TipTapCommentEditor from "@/components/common/tiptap-comment-editor";
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

const poetryFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#faf8ff",
  sidebarForeground: "#43245d",
  sidebarBorder: "#e4d9ee",
  label: "#8154a3",
  muted: "#77578f",
  inputBorder: "#d7d0ea",
  inputText: "#43245d",
  chipBorder: "#d7d0ea",
  chipText: "#43245d",
  chipHoverBackground: "#faf4ff",
  checkBorder: "#b79ad1",
  checkboxText: "#5f466f",
  accent: "#5a2f85",
  accentHoverBackground: "#47216b",
  triggerBorder: "#d8b5ff",
  triggerBackground: "#fbf4ff",
  triggerText: "#6e3f98",
  triggerHoverBackground: "#f5e9ff",
};
import TiptapRenderer from "@/components/discuss/tiptap-renderer";
import {
  createEmptyTipTapDocument,
  isSerializedTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
} from "@/components/db/types/poem-term-validation";
import { PoemTagOption, PoetryHomePoem } from "@/components/db/types/poem-verses";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { MemberKeyDetails } from "@/features/family/types/family-steps";
import { clearQueuedFeatureComment, createClientRequestId, getPwaSyncNowEventName, isBrowserOnline, queueFeatureComment, readQueuedFeatureComments } from "@/lib/pwa-background-sync";

type PoemDraft = {
  id: number;
  poemTitle: string;
  poetName: string;
  poemYear: string;
  submitterName: string;
  submitterImageUrl: string | null;
  dislikeCount: number;
  likeCount: number;
  loveCount: number;
  commentCount: number;
  userReactionType: number | null;
  memberId: number;
  familyId: number;
  status: string;
  createdAt: Date;
  verseJson: string;
  analysisJson: string;
  selectedTagIds: number[];
  discussionThreads: PoetryHomePoem["discussionThreads"];
  hasDiscussionThread: boolean;
  hasClubSession: boolean;
  dislikeMemberNames: string[];
  likeMemberNames: string[];
  loveMemberNames: string[];
  poemComments: Array<{
    id: number;
    createdAt: Date;
    commenterName: string;
    commentJson: string;
  }>;
};

type PoetryDirectoryMode = "all" | "latest" | "top-rated";

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

function createSubmitterLabel(poemRecord: PoetryHomePoem, member: MemberKeyDetails) {
  if (poemRecord.submitterName) {
    return poemRecord.submitterName;
  }

  if (poemRecord.memberId === member.memberId) {
    return `${ member.firstName } ${ member.lastName }`;
  }

  return `Member #${ poemRecord.memberId }`;
}

function createDraftFromPoem(poemRecord: PoetryHomePoem, member: MemberKeyDetails): PoemDraft {
  return {
    id: poemRecord.id,
    poemTitle: poemRecord.poemTitle,
    poetName: poemRecord.poetName,
    poemYear: poemRecord.poemYear ? String(poemRecord.poemYear) : "",
    submitterName: createSubmitterLabel(poemRecord, member),
    submitterImageUrl: poemRecord.submitterImageUrl ?? null,
    dislikeCount: poemRecord.dislikeCount ?? 0,
    likeCount: poemRecord.likeCount ?? 0,
    loveCount: poemRecord.loveCount ?? 0,
    commentCount: poemRecord.commentCount ?? 0,
    userReactionType: poemRecord.userReactionType ?? null,
    memberId: poemRecord.memberId,
    familyId: poemRecord.familyId,
    status: poemRecord.status,
    createdAt: new Date(poemRecord.createdAt),
    verseJson: poemRecord.verseJson ?? JSON.stringify(createEmptyTipTapDocument()),
    analysisJson: poemRecord.analysisJson ?? JSON.stringify(createEmptyTipTapDocument()),
    selectedTagIds: poemRecord.selectedTagIds ?? [],
    discussionThreads: poemRecord.discussionThreads ?? [],
    hasDiscussionThread: poemRecord.hasDiscussionThread ?? false,
    hasClubSession: poemRecord.hasClubSession ?? false,
    dislikeMemberNames: poemRecord.dislikeMemberNames ?? [],
    likeMemberNames: poemRecord.likeMemberNames ?? [],
    loveMemberNames: poemRecord.loveMemberNames ?? [],
    poemComments: poemRecord.poemComments ?? [],
  };
}

function ReactionMemberHoverCard({
  icon,
  count,
  memberNames,
  triggerClassName,
  textClassName,
  emptyLabel,
}: {
  icon: React.ReactNode;
  count: number;
  memberNames: string[];
  triggerClassName: string;
  textClassName?: string;
  emptyLabel: string;
}) {
  return (
    <HoverCard openDelay={ 120 } closeDelay={ 100 }>
      <HoverCardTrigger asChild>
        <span className={ `inline-flex cursor-default items-center gap-1.5 text-sm font-semibold ${ triggerClassName } ${ textClassName ?? "" }` }>
          { icon }
          { count.toLocaleString() }
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="font-app w-56 border-[#d7d0ea] bg-white text-xs text-[#5f466f]">
        <p className="font-semibold text-[#43245d]">{ emptyLabel }</p>
        { memberNames.length > 0 ? (
          <ul className="mt-2 space-y-1">
            { memberNames.map((memberName) => (
              <li key={ memberName }>{ memberName }</li>
            )) }
          </ul>
        ) : (
          <p className="mt-2 text-[#77578f]">No family members yet.</p>
        ) }
      </HoverCardContent>
    </HoverCard>
  );
}

function getEditorLineCount(editor: Editor | null) {
  if (!editor) {
    return 1;
  }

  const editorText = editor.getText({ blockSeparator: "\n" });

  if (!editorText.trim()) {
    return 1;
  }

  return editorText.split("\n").length;
}

export default function PoetryHomePage({
  poems,
  member,
  poemTags = [],
}: {
  poems: PoetryHomePoem[];
  member: MemberKeyDetails;
  poemTags?: PoemTagOption[];
}) {
  const router = useRouter();
  const [isEngaging, startEngageTransition] = useTransition();
  const [poemItems, setPoemItems] = useState(() => poems.map((poemRecord) => createDraftFromPoem(poemRecord, member)));
  const [selectedPoemId, setSelectedPoemId] = useState<number | null>(poems.find((poemRecord) => poemRecord.status === "published")?.id ?? poems[0]?.id ?? null);
  const [commentText, setCommentText] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterWithClubSessions, setFilterWithClubSessions] = useState(false);
  const [expandPoemCards, setExpandPoemCards] = useState(true);
  const [directoryMode, setDirectoryMode] = useState<PoetryDirectoryMode>("all");
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
  const [isPoemDialogOpen, setIsPoemDialogOpen] = useState(false);
  const [verseLineCount, setVerseLineCount] = useState(1);
  const [verseLines, setVerseLines] = useState<string[]>([""]);
  const deferredSearchValue = useDeferredValue(searchValue);
  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;

  useEffect(() => {
    const nextPoemItems = poems.map((poemRecord) => createDraftFromPoem(poemRecord, member));

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPoemItems(nextPoemItems);
    setSelectedPoemId((currentSelectedPoemId) => {
      if (currentSelectedPoemId && nextPoemItems.some((poemItem) => poemItem.id === currentSelectedPoemId)) {
        return currentSelectedPoemId;
      }

      return nextPoemItems[0]?.id ?? null;
    });
  }, [member, poems]);

  const selectedPoem = poemItems.find((poemItem) => poemItem.id === selectedPoemId) ?? null;
  const canEditSelected = selectedPoem
    ? selectedPoem.memberId === member.memberId || member.isFounder
    : false;

  const verseViewer = useEditor({
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: true,
      }),
    ],
    content: getEditorDocument(selectedPoem?.verseJson),
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-[14rem]",
      },
    },
  });

  const analysisViewer = useEditor({
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: true,
      }),
    ],
    content: getEditorDocument(selectedPoem?.analysisJson),
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-[12rem]",
      },
    },
  });

  useEffect(() => {
    if (!verseViewer) {
      return;
    }

    verseViewer.commands.setContent(getEditorDocument(selectedPoem?.verseJson));
    const editorText = verseViewer.getText({ blockSeparator: "\n" });
    const nextLines = editorText.trim().length === 0 ? [""] : editorText.split("\n");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerseLines(nextLines);
    setVerseLineCount(nextLines.length);
  }, [selectedPoem?.id, selectedPoem?.verseJson, verseViewer]);

  useEffect(() => {
    if (!analysisViewer) {
      return;
    }

    analysisViewer.commands.setContent(getEditorDocument(selectedPoem?.analysisJson));
  }, [analysisViewer, selectedPoem?.analysisJson, selectedPoem?.id]);

  const visiblePoemItems = useMemo(() => (
    poemItems.filter((poemItem) => (
      poemItem.status === "published"
      || (poemItem.status === "draft" && (poemItem.memberId === member.memberId || member.isFounder))
      || (includeArchived && poemItem.status === "archived")
    ))
  ), [poemItems, includeArchived, member.isFounder, member.memberId]);

  const directoryPoems = useMemo(() => {
    const scopedPoemItems = visiblePoemItems.filter((poemItem) => {
      const createdAt = new Date(poemItem.createdAt);

      if (startDateValue && createdAt < startDateValue) {
        return false;
      }

      if (endDateValue && createdAt > endDateValue) {
        return false;
      }

      return true;
    });

    if (directoryMode === "all") {
      return [...scopedPoemItems].sort((leftPoem, rightPoem) => (
        leftPoem.poemTitle.localeCompare(rightPoem.poemTitle, undefined, { sensitivity: "base" })
      ));
    }

    if (directoryMode === "latest") {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

      return scopedPoemItems
        .filter((poemItem) => new Date(poemItem.createdAt).getTime() >= twoMonthsAgo.getTime())
        .sort((leftPoem, rightPoem) => (
          new Date(rightPoem.createdAt).getTime() - new Date(leftPoem.createdAt).getTime()
        ))
        .slice(0, 8);
    }

    return scopedPoemItems
      .filter((poemItem) => (poemItem.likeCount + poemItem.loveCount) > 0)
      .sort((leftPoem, rightPoem) => {
        const rightScore = rightPoem.likeCount + rightPoem.loveCount;
        const leftScore = leftPoem.likeCount + leftPoem.loveCount;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return new Date(rightPoem.createdAt).getTime() - new Date(leftPoem.createdAt).getTime();
      })
      .slice(0, 8);
  }, [directoryMode, endDateValue, startDateValue, visiblePoemItems]);

  const filteredPoems = useMemo(() => {
    const normalizedQuery = deferredSearchValue.trim().toLowerCase();
    const poemsWithFilter = filterWithClubSessions
      ? directoryPoems.filter((poemItem) => poemItem.hasClubSession)
      : directoryPoems;

    if (!normalizedQuery) {
      return poemsWithFilter;
    }

    return poemsWithFilter.filter((poemItem) => (
      poemItem.poemTitle.toLowerCase().includes(normalizedQuery)
      || poemItem.poetName.toLowerCase().includes(normalizedQuery)
      || poemItem.poemYear.toLowerCase().includes(normalizedQuery)
      || poemItem.submitterName.toLowerCase().includes(normalizedQuery)
    ));
  }, [deferredSearchValue, directoryPoems, filterWithClubSessions]);

  useEffect(() => {
    if (filteredPoems.length === 0) {
      return;
    }

    if (selectedPoemId && filteredPoems.some((poemItem) => poemItem.id === selectedPoemId)) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPoemId(filteredPoems[0].id);
  }, [filteredPoems, selectedPoemId]);

  const selectedPoemTags = useMemo(() => {
    if (!selectedPoem) {
      return [] as PoemTagOption[];
    }

    return poemTags.filter((tagOption) => selectedPoem.selectedTagIds.includes(tagOption.id));
  }, [poemTags, selectedPoem]);

  const useTwoColumnVerseLayout = verseLineCount > 40;
  const verseSplitIndex = Math.ceil(verseLineCount / 2);
  const verseColumnOneLines = verseLines.slice(0, verseSplitIndex);
  const verseColumnTwoLines = verseLines.slice(verseSplitIndex);

  function handleSelectPoem(poemId: number) {
    setCommentText("");
    setSelectedPoemId(poemId);
  }

  function handleOpenPoemFromCard(poemId: number) {
    handleSelectPoem(poemId);
    setIsPoemDialogOpen(true);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function handleAddPoem() {
    router.push("/poetry/add-poem");
  }

  function openPoemDialog() {
    if (!selectedPoem) {
      return;
    }
    setIsPoemDialogOpen(true);
  }

  function handleEditPoem() {
    if (!selectedPoem) {
      return;
    }

    if (!canEditSelected) {
      toast.error("Only the poem submitter can edit this poem.");
      return;
    }

    router.push(`/poetry/add-poem?id=${ selectedPoem.id }`);
  }

  function applyPoemRefresh(updatedPoem: PoetryHomePoem) {
    const updatedDraft = createDraftFromPoem(updatedPoem, member);

    setPoemItems((currentPoems) => {
      if (!currentPoems.some((poemItem) => poemItem.id === updatedDraft.id)) {
        return [updatedDraft, ...currentPoems];
      }

      return currentPoems.map((poemItem) => (poemItem.id === updatedDraft.id ? updatedDraft : poemItem));
    });
    setSelectedPoemId(updatedDraft.id);
  }

  useEffect(() => {
    const flushQueuedPoemComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFeatureComments().filter((item) => item.kind === "poem");

      for (const queuedComment of queuedComments) {
        const result = await addPoemCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFeatureComment(queuedComment.payload.clientRequestId);
        }

        applyPoemRefresh(result.poem);
      }
    };

    void flushQueuedPoemComments();

    const handleSync = () => {
      void flushQueuedPoemComments();
    };

    window.addEventListener("online", handleSync);
    window.addEventListener(getPwaSyncNowEventName(), handleSync);

    return () => {
      window.removeEventListener("online", handleSync);
      window.removeEventListener(getPwaSyncNowEventName(), handleSync);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  function handleToggleReaction(reactionType: -1 | 1 | 2) {
    if (!selectedPoem) {
      return;
    }

    if (!isPoemDialogOpen) {
      toast.error("Open View Poem before posting a reaction.");
      return;
    }

    startEngageTransition(async () => {
      const result = await togglePoemReactionAction({
        poemId: selectedPoem.id,
        reactionType,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      applyPoemRefresh(result.poem);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedPoem) {
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);

    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const payload = {
        poemId: selectedPoem.id,
        commentText: normalizedComment,
        clientRequestId: createClientRequestId("poem-comment"),
      };
      const result = await addPoemCommentAction(payload);

      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFeatureComment({
            kind: "poem",
            payload,
            itemTitle: selectedPoem.poemTitle,
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

      applyPoemRefresh(result.poem);
      setCommentText("");
      toast.success(result.message);
    });
  }

  return (
    <FilterSidebarProvider palette={ poetryFilterPalette }>
      <FilterSidebar title="Poem Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by poem, poet, year, or family member"
          ariaLabel="Search poems"
        />
        <FilterSidebarDateScope
          radioName="poetry-date-scope"
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
        <FilterSidebarGroup label="Poem Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="poetry-directory-mode" value="all" checked={ directoryMode === "all" } onChange={ () => setDirectoryMode("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="poetry-directory-mode" value="latest" checked={ directoryMode === "latest" } onChange={ () => setDirectoryMode("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="poetry-directory-mode" value="top-rated" checked={ directoryMode === "top-rated" } onChange={ () => setDirectoryMode("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived Also</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithClubSessions } onChange={ setFilterWithClubSessions }>Clubs Only</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ expandPoemCards } onChange={ setExpandPoemCards }>Expand Poem Cards</FilterSidebarCheckbox>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app min-w-0 flex-1 px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(57,27,88,0.96),rgba(104,53,148,0.88)_56%,rgba(195,150,110,0.84))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(46,18,70,0.95)] sm:px-8 sm:py-8 lg:px-10">
          <div className="flex flex-col gap-3 sm:gap-5">
            <div className="max-w-3xl">
              <p className="text-[1rem] font-bold uppercase tracking-[0.28em] text-[#f1deff]">
                Family Poetry Nook
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f6ebff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <HouseHeart className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  Go Home
                </Link>
                <Link
                  href="/poem-terms"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f6ebff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <LibraryBig className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  Tags & Terms
                </Link>
                  <Link
                    href="/add-club?from=poetry"
                    className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f6ebff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                  >
                    <UsersRound className="mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                    Clubs
                  </Link>
              </div>

              {/* <h1 className="mt-3 text-base font-black leading-snug tracking-tight sm:mt-4 sm:text-2xl">
                Share your favorite poetry. Comment on each other&apos;s favorites.
              </h1> */}
            </div>
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-40px_rgba(57,27,88,0.7)] backdrop-blur">
          <div className="border-b border-[#e4d9ee] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(249,244,255,0.86))] px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#8154a3]">Poetry Directory</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#77578f]">
                  <h2 className="text-2xl font-black tracking-tight text-[#43245d]">Find a Poem</h2>
                  <FeatureFaqHelp
                    href=" /feature-faq?category=Poetry%20Nook"
                    buttonClassName="h-4 w-4 md:h-7 md:w-7border-[#d8b5ff] bg-gradient-to-b from-[#fbf4ff] to-[#eddcff] text-[#6e3f98] shadow-[0_8px_18px_rgba(110,63,152,0.22)] group-hover:shadow-[0_12px_26px_rgba(110,63,152,0.3)]"
                    iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#6e3f98]"
                    tooltipClassName="bg-[#4e2374] text-[#f6ebff]"
                  />
                  <EditPostIcon tooltip="Filter Poems" tooltipClassName="bg-[#4e2374] text-[#f6ebff]">
                    <FilterSidebarTrigger ariaLabel="Toggle poem filters" />
                  </EditPostIcon>
                  <EditPostIcon tooltip="View Poem" tooltipClassName="bg-[#4e2374] text-[#f6ebff]">
                    <Button
                      type="button"
                      onClick={ () => openPoemDialog() }
                      disabled={ !selectedPoem }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#d8b5ff] bg-[#fbf4ff] px-2 text-xs font-semibold text-[#6e3f98] shadow-[0_8px_18px_rgba(110,63,152,0.16)] hover:bg-[#f5e9ff] disabled:opacity-50 sm:px-3"
                      aria-label="View selected poem"
                    >
                      <Eye className="size-3.5" />
                      <span className="hidden sm:inline">View</span>
                    </Button>
                  </EditPostIcon>
                  <EditPostIcon tooltip="Edit Poem" tooltipClassName="bg-[#4e2374] text-[#f6ebff]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={ handleEditPoem }
                      disabled={ !selectedPoem || !canEditSelected }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#d8b5ff] bg-white px-2 text-xs font-semibold text-[#6e3f98] hover:bg-[#f5e9ff] disabled:opacity-50 sm:px-3"
                      aria-label="Edit selected poem"
                    >
                      <PenSquare className="size-3.5" />
                      <span className="hidden sm:inline">Edit</span>
                    </Button>
                  </EditPostIcon>
                  <EditPostIcon tooltip="Add Poem" tooltipClassName="bg-[#4e2374] text-[#f6ebff]">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={ handleAddPoem }
                      className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#d8b5ff] bg-white px-2 text-xs font-semibold text-[#6e3f98] hover:bg-[#f5e9ff] sm:px-3"
                      aria-label="Add poem"
                    >
                      <Plus className="size-3.5" />
                      <span className="hidden sm:inline">Add</span>
                    </Button>
                  </EditPostIcon>
                </div>
                {/* <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77578f]">
                  Select a poem card from the directory, or use search to narrow the list, then open View Poem or Edit Poem details in a separate dialog.
                </p> */}
              </div>

              {/* <div className="rounded-full border border-[#e4d9ee] bg-[#faf6ff] px-4 py-2 text-sm font-semibold text-[#77578f]">
                { poemItems.length } poem{ poemItems.length !== 1 ? "s" : "" }
              </div> */}
            </div>

          </div>

          <div className="px-5 py-5 sm:px-6">
            { poemItems.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-[#d7d0ea] bg-[#faf8ff] px-6 py-10 text-center text-[#77578f]">
                <LibraryBig className="mx-auto mb-3 size-10 text-[#9a79b8]" />
                <p className="text-lg font-semibold text-[#43245d]">No poem facts are available yet.</p>
                <p className="mt-2 text-sm">Use Add Poem to create the first submission for this family.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-4">
                  { filteredPoems.map((poemItem) => {
                    const isSelected = poemItem.id === selectedPoemId;

                    return (
                      <button
                        key={ poemItem.id }
                        type="button"
                        onClick={ () => handleSelectPoem(poemItem.id) }
                        onDoubleClick={ () => handleOpenPoemFromCard(poemItem.id) }
                        className={ `grid min-w-0 w-full gap-2 rounded-[1.4rem] border px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8c62b5] sm:gap-3 sm:px-4 sm:py-4 ${ isSelected
                          ? "border-[#8c62b5] bg-[linear-gradient(135deg,rgba(244,236,255,0.95),rgba(252,248,255,0.95))] shadow-[0_18px_45px_-35px_rgba(80,40,120,0.7)]"
                          : "border-[#e6deef] bg-white hover:border-[#c7b2db] hover:bg-[#fcfaff]"
                          }` }
                      >
                        <div>
                          { expandPoemCards ? (
                            <div className="flex flex-wrap items-start gap-1">
                              <p className="min-w-0 wrap-break-word line-clamp-2 text-xs font-bold leading-snug text-[#43245d] sm:text-sm">{ poemItem.poemTitle }</p>
                              { poemItem.hasClubSession ? (
                                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#efe6fb] text-[#6e3f98]" title="Club session available">
                                  <MessageSquare className="size-3" aria-label="Club session available" />
                                </span>
                              ) : null }
                            </div>
                          ) : (
                            <p className="min-w-0 wrap-break-word line-clamp-2 text-xs font-bold leading-snug text-[#43245d] sm:text-sm">{ poemItem.poemTitle }</p>
                          ) }
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.7rem] text-[#8d739f] sm:flex-nowrap sm:text-xs">
                            { poemItem.submitterImageUrl ? (
                              <span className="inline-flex" title={ poemItem.submitterName }>
                                <MemberAvatar imageUrl={ poemItem.submitterImageUrl } firstName={ poemItem.submitterName } sizeClassName="h-[26px] w-[26px]" />
                              </span>
                            ) : <span className="wrap-break-word font-semibold text-[#5c446f]">{ poemItem.submitterName }</span> }
                            <span className="whitespace-nowrap">{ formatCreatedAt(poemItem.createdAt) }</span>
                          </div>
                          { poemItem.status === "draft" ? (
                            <p className="mt-1 inline-flex w-fit rounded-full border border-[#d4a64f] bg-[#fff5dc] px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-[#9a5a06] sm:text-[0.65rem]">
                              Draft
                            </p>
                          ) : null }
                        </div>
                        { expandPoemCards ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 sm:gap-x-2 md:gap-x-3">
                              <div className="min-w-26">
                                <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-[#8b69ab]">Poet</p>
                                <p className="text-xs font-semibold text-[#5c446f] sm:text-sm">{ poemItem.poetName }</p>
                              </div>
                              <div className="min-w-18">
                                <p className="text-[0.64rem] font-bold uppercase tracking-[0.16em] text-[#8b69ab]">Year</p>
                                <p className="text-xs font-semibold text-[#5c446f] sm:text-sm">{ poemItem.poemYear || "-" }</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-1 gap-y-1 sm:gap-x-1.5 md:gap-x-2">
                              <div className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#5c446f] sm:text-xs">
                                <ThumbsDown className="size-3 text-[#7b6394] sm:size-3.5" />
                                { poemItem.dislikeCount }
                              </div>
                              <div className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#5c446f] sm:text-xs">
                                <ThumbsUp className="size-3 text-[#6e3f98] sm:size-3.5" />
                                { poemItem.likeCount }
                              </div>
                              <div className="inline-flex items-center gap-1 text-[0.7rem] font-semibold text-[#5c446f] sm:text-xs">
                                <Heart className="size-3 text-[#a86a8e] sm:size-3.5" />
                                { poemItem.loveCount }
                              </div>
                              <div className="inline-flex min-w-18 items-center gap-1.5 text-xs font-semibold text-[#5c446f] sm:text-sm">
                                <MessageSquare className="size-3.5 text-[#7a5a9f] sm:size-4" />
                                { poemItem.commentCount }
                              </div>
                            </div>
                          </div>
                        ) : null }
                      </button>
                    );
                  }) }
                </div>

                { filteredPoems.length === 0 ? (
                  <div className="mt-4 rounded-[1.3rem] border border-dashed border-[#d7d0ea] bg-[#faf8ff] px-4 py-6 text-center text-sm text-[#77578f]">
                    { directoryMode === "top-rated"
                      ? "No top rated poems found yet. Poems need at least one rating to appear here."
                      : "No poems match that search yet." }
                  </div>
                ) : null }
              </>
            ) }
          </div>
        </div>
      </div>

      <Dialog open={ isPoemDialogOpen } onOpenChange={ setIsPoemDialogOpen }>
        <DialogContent
          className="font-app top-[6vh]! translate-y-0! max-h-[88vh] overflow-hidden border-[#d7d0ea] bg-[#fcf9ff] sm:max-w-5xl lg:max-w-6xl"
          onOpenAutoFocus={ (event) => event.preventDefault() }
        >
          <DialogHeader>
            <DialogTitle className="text-[#43245d]">
              { selectedPoem?.poemTitle ?? "Poem Details" }
            </DialogTitle>
            <DialogDescription className="text-[#77578f]">
              Read poem details, analysis, and family reactions.
            </DialogDescription>
          </DialogHeader>

          { selectedPoem ? (
            <div className="max-h-[74vh] space-y-4 overflow-auto pr-1">
              <div className="rounded-[1.4rem] border border-[#e4d9ee] bg-[#fcfaff] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#8154a3]">Poem Verse</p>
                    <p className="mt-1 text-sm text-[#5f466f]">
                      { selectedPoem.poemTitle } by { selectedPoem.poetName } ({ selectedPoem.poemYear || "Unknown year" })
                    </p>
                  </div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[#8a6da3]">
                    Added { formatCreatedAt(selectedPoem.createdAt) }
                  </p>
                </div>

                { useTwoColumnVerseLayout ? (
                  <div className="mt-3 max-h-120 overflow-auto rounded-[1.2rem] border border-[#d7d0ea] bg-[#f8f3ff] p-2">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="overflow-hidden rounded-3xl border border-[#d7d0ea] bg-white">
                        <div className="py-4">
                          { verseColumnOneLines.map((line, index) => (
                            <div key={ `left-${index + 1}` } className="flex min-h-6">
                              <div className="w-12 shrink-0 border-r border-[#e6deef] bg-[#faf7ff] text-center text-sm leading-6 tabular-nums text-[#8b69ab]">
                                { index + 1 }
                              </div>
                              <div className="min-w-0 flex-1 px-4 text-sm leading-6 text-[#43245d] whitespace-pre-wrap wrap-break-word">
                                { line || "\u00A0" }
                              </div>
                            </div>
                          )) }
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-3xl border border-[#d7d0ea] bg-white">
                        <div className="py-4">
                          { verseColumnTwoLines.map((line, index) => (
                            <div key={ `right-${verseSplitIndex + index + 1}` } className="flex min-h-6">
                              <div className="w-12 shrink-0 border-r border-[#e6deef] bg-[#faf7ff] text-center text-sm leading-6 tabular-nums text-[#8b69ab]">
                                { verseSplitIndex + index + 1 }
                              </div>
                              <div className="min-w-0 flex-1 px-4 text-sm leading-6 text-[#43245d] whitespace-pre-wrap wrap-break-word">
                                { line || "\u00A0" }
                              </div>
                            </div>
                          )) }
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-[#d7d0ea] bg-white">
                    <div className="flex max-h-120 overflow-auto">
                      <div className="min-w-0 flex-1 [&_.tiptap]:px-4 [&_.tiptap]:py-4 [&_.tiptap]:text-[#43245d] [&_.tiptap]:leading-6 [&_.tiptap]:outline-none [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-[#cfbbe3] [&_.tiptap_blockquote]:pl-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 poem-verse-numbered">
                        <EditorContent editor={ verseViewer } />
                      </div>
                    </div>
                  </div>
                ) }
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="rounded-[1.4rem] border border-[#e4d9ee] bg-[#fcfaff] p-4 xl:col-span-2">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#8154a3]">Poem Analysis</p>
                  <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-[#d7d0ea] bg-white px-4 py-4 [&_.tiptap]:text-[#43245d] [&_.tiptap]:outline-none [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-[#cfbbe3] [&_.tiptap_blockquote]:pl-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5">
                    <EditorContent editor={ analysisViewer } />
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-[#e4d9ee] bg-[#fcfaff] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#5d426f]">Poem Tags</p>
                    <div className="inline-flex items-center rounded-full border border-[#d7d0ea] bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#7b54a0]">
                      <Tags className="mr-2 size-3.5" />
                      { selectedPoemTags.length } tag{ selectedPoemTags.length !== 1 ? "s" : "" }
                    </div>
                  </div>

                  { selectedPoemTags.length === 0 ? (
                    <p className="mt-3 rounded-2xl border border-dashed border-[#d7d0ea] bg-white px-3 py-2 text-sm text-[#77578f]">
                      This poem has no tags selected yet.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      { selectedPoemTags.map((tagOption) => (
                        <span
                          key={ tagOption.id }
                          className="inline-flex items-center rounded-full border border-[#d9c9ea] bg-white px-3 py-1 text-xs font-semibold text-[#5f466f]"
                        >
                          { tagOption.tagName }
                        </span>
                      )) }
                    </div>
                  ) }
                </div>
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#e4d9ee] bg-[#fcfaff] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#5d426f]">Family Comments</p>
                    <p className="text-sm text-[#77578f]">Share your thoughts on this poem with your family.</p>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-[#d7d0ea] bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#7b54a0]">
                    <MessageSquare className="mr-2 size-3.5" />
                    { selectedPoem.commentCount } comments
                  </div>
                </div>

                <div className="rounded-[1.15rem] border border-[#e5daf0] bg-white px-3 py-3">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                    { selectedPoem.memberId !== member.memberId ? (
                      <>
                        <Button
                          type="button"
                          onClick={ () => handleToggleReaction(-1) }
                          disabled={ isEngaging }
                          className={ `rounded-full ${ selectedPoem.userReactionType === -1
                            ? "bg-[#5a2f85] text-white hover:bg-[#47216b]"
                            : "border border-[#d7d0ea] bg-white text-[#5f466f] hover:bg-[#f7f2ff]" }` }
                        >
                          <ThumbsDown className="size-4" />
                          Dislike
                        </Button>
                        <Button
                          type="button"
                          onClick={ () => handleToggleReaction(1) }
                          disabled={ isEngaging }
                          className={ `rounded-full ${ selectedPoem.userReactionType === 1
                            ? "bg-[#5a2f85] text-white hover:bg-[#47216b]"
                            : "border border-[#d7d0ea] bg-white text-[#5f466f] hover:bg-[#f7f2ff]" }` }
                        >
                          <ThumbsUp className="size-4" />
                          Like
                        </Button>
                        <Button
                          type="button"
                          onClick={ () => handleToggleReaction(2) }
                          disabled={ isEngaging }
                          className={ `rounded-full ${ selectedPoem.userReactionType === 2
                            ? "bg-[#5a2f85] text-white hover:bg-[#47216b]"
                            : "border border-[#d7d0ea] bg-white text-[#5f466f] hover:bg-[#f7f2ff]" }` }
                        >
                          <Heart className={ `size-4 ${ selectedPoem.userReactionType === 2 ? "fill-white" : "" }` } />
                          Love
                        </Button>
                      </>
                    ) : null }
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <ReactionMemberHoverCard
                        icon={ <ThumbsDown className="size-4 text-[#7b6394]" /> }
                        count={ selectedPoem.dislikeCount ?? 0 }
                        memberNames={ selectedPoem.dislikeMemberNames ?? [] }
                        triggerClassName="text-[#5f466f]"
                        emptyLabel="Family members who disliked this poem"
                      />
                      <ReactionMemberHoverCard
                        icon={ <ThumbsUp className="size-4 text-[#6e3f98]" /> }
                        count={ selectedPoem.likeCount ?? 0 }
                        memberNames={ selectedPoem.likeMemberNames ?? [] }
                        triggerClassName="text-[#5f466f]"
                        emptyLabel="Family members who liked this poem"
                      />
                      <ReactionMemberHoverCard
                        icon={ <Heart className="size-4 text-[#a86a8e]" /> }
                        count={ selectedPoem.loveCount ?? 0 }
                        memberNames={ selectedPoem.loveMemberNames ?? [] }
                        triggerClassName="text-[#5f466f]"
                        emptyLabel="Family members who loved this poem"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  { selectedPoem.poemComments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#d7d0ea] bg-white px-3 py-2 text-sm text-[#77578f]">
                      No comments yet. Be the first family member to add one.
                    </p>
                  ) : (
                    selectedPoem.poemComments.map((poemComment) => (
                      <article key={ poemComment.id } className="rounded-2xl border border-[#e5daf0] bg-white px-3 py-3 text-sm text-[#5f466f]">
                        <TiptapRenderer contentJson={ poemComment.commentJson } />
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8a6da3]">
                          { poemComment.commenterName } · { formatCreatedAt(poemComment.createdAt) }
                        </p>
                      </article>
                    ))
                  ) }
                </div>

                { selectedPoem.memberId !== member.memberId ? (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#5d426f]" htmlFor="poem-comment-input">Add Comment</label>
                    <div id="poem-comment-input">
                      <TipTapCommentEditor
                        value={ commentText }
                        onChange={ setCommentText }
                        placeholder="What stood out to you in this poem?"
                        disabled={ isEngaging }
                        toolbarClassName="border-[#d7d0ea] bg-[#f7f1ff]"
                        editorClassName="border-[#d7d0ea] text-[#43245d]"
                        buttonClassName="border-[#d8b5ff] text-[#5d426f]"
                        activeButtonClassName="border-[#8c62b5] bg-[#efe6fb] text-[#43245d]"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={ handleAddComment }
                        disabled={ isEngaging || isSerializedTipTapDocumentEmpty(commentText) }
                        className="rounded-full bg-[#5a2f85] text-white hover:bg-[#47216b]"
                      >
                        Post Comment
                      </Button>
                    </div>
                  </div>
                ) : null }
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#e4d9ee] bg-[#fcfaff] p-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#8154a3]">Discussion Threads</p>
                  <p className="text-xs text-[#77578f]">Follow the conversation that belongs to this poem.</p>
                </div>

                { selectedPoem.discussionThreads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#d7d0ea] bg-[#faf8ff] px-3 py-3 text-sm text-[#77578f]">
                    <p>No discussion threads have been added for this poem yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    { selectedPoem.discussionThreads.map((discussionThread) => (
                      <article key={ discussionThread.id } className="rounded-2xl border border-[#e5daf0] bg-[#fcfaff] px-4 py-4 text-sm text-[#5f466f] shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-base font-bold leading-snug text-[#43245d]">{ discussionThread.discussTopic }</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8a6da3]">
                              { discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-3">
                            { discussionThread.dislikeCount > 0 || discussionThread.likeCount > 0 || discussionThread.loveCount > 0 ? (
                              <div className="flex flex-wrap items-center gap-2">
                                { discussionThread.dislikeCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f3edf8] px-2 py-1 text-[0.65rem] font-semibold text-[#5f466f]">
                                    <ThumbsDown className="size-3" />
                                    { discussionThread.dislikeCount }
                                  </span>
                                ) : null }
                                { discussionThread.likeCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#efe6fb] px-2 py-1 text-[0.65rem] font-semibold text-[#6e3f98]">
                                    <ThumbsUp className="size-3" />
                                    { discussionThread.likeCount }
                                  </span>
                                ) : null }
                                { discussionThread.loveCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fbe7f2] px-2 py-1 text-[0.65rem] font-semibold text-[#a14f7a]">
                                    <Heart className="size-3 fill-current" />
                                    { discussionThread.loveCount }
                                  </span>
                                ) : null }
                              </div>
                            ) : null }

                            <Button
                              type="button"
                              variant="outline"
                              asChild
                              className="shrink-0 rounded-full border-[#d8b5ff] bg-white px-4 text-xs font-semibold text-[#43245d] hover:bg-[#f5e9ff] hover:text-[#43245d]"
                            >
                              <Link href={ `/poetry/discussions/${ discussionThread.id }` }>
                                View
                              </Link>
                            </Button>
                          </div>
                        </div>
                      </article>
                    )) }
                  </div>
                ) }
              </div>
            </div>
          ) : null }
        </DialogContent>
      </Dialog>
      </section>
    </FilterSidebarProvider>
  );
}
