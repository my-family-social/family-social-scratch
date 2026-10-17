"use client";

import type { JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { CircleHelp, Edit3, ExternalLink, Eye, Heart, HouseHeart, MessageSquare, MessageSquareText, Plus, ThumbsDown, ThumbsUp, Tv } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addShowCommentAction,
  getShowDetailAction,
  toggleShowLikeAction,
} from "@/app/(features)/(tv)/tv/actions";
import TipTapCommentEditor from "@/components/common/tiptap-comment-editor";
import MemberAvatar from "@/components/common/member-avatar";
import TiptapRenderer from "@/components/discuss/tiptap-renderer";
import StartDiscussionDialog from "@/components/discuss/start-discussion-dialog";
import type { GuidedTourLaunchPayload } from "@/components/db/sql/queries-guided-runtime";
import {
  createEmptyTipTapDocument,
  isSerializedTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
} from "@/components/db/types/poem-term-validation";
import { TvShow, TvShowDetail } from "@/components/db/types/shows";
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
import GuidedTourLauncher from "@/features/guided/components/guided-tour-launcher";
import { normalizeShowSiteBackgroundHex } from "@/features/support/types/constants";
import { TvScrollStrip } from "@/features/tv/components/tv-scroll-strip";
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import { clearQueuedFeatureComment, createClientRequestId, getPwaSyncNowEventName, isBrowserOnline, queueFeatureComment, readQueuedFeatureComments } from "@/lib/pwa-background-sync";
import { cn } from "@/lib/utils";
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

const tvFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#f6fbfe",
  sidebarForeground: "#15384a",
  sidebarBorder: "#d7ebf3",
  label: "#45829a",
  muted: "#4f7384",
  inputBorder: "#c9e2ec",
  inputText: "#15384a",
  chipBorder: "#c7dfeb",
  chipText: "#15384a",
  chipHoverBackground: "#f1f8fb",
  checkBorder: "#86b3c5",
  checkboxText: "#24536a",
  accent: "#2d87a8",
  accentHoverBackground: "#256e89",
  triggerBorder: "#c9e2ec",
  triggerBackground: "#f6fbfe",
  triggerText: "#15384a",
  triggerHoverBackground: "#dff2f9",
};



function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatCreatedAt(createdAt: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ year }-${ month }-${ day }`;
}

function formatShortDate(value: Date) {
  const parsed = new Date(value);
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const yy = String(parsed.getFullYear()).slice(-2);
  return `${ mm }-${ dd }-${ yy }`;
}

function getShowDocument(showJson?: string): JSONContent {
  if (!showJson) {
    return createEmptyTipTapDocument();
  }

  const parsed = parseSerializedTipTapDocument(showJson);
  return parsed.success ? parsed.content : createEmptyTipTapDocument();
}

function getShowTagNames(show: TvShow) {
  return [
    ...(show.tagNamesByType.genre ?? []),
    ...(show.tagNamesByType.adjective ?? []),
    ...(show.tagNamesByType.channel ?? []),
  ].filter((tagName, index, tagNames) => tagNames.indexOf(tagName) === index);
}

function ShowViewer({ showJson }: { showJson?: string }) {
  const viewer = useEditor({
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: true,
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: getShowDocument(showJson),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-112 text-[#12384e] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!viewer) {
      return;
    }

    viewer.commands.setContent(getShowDocument(showJson));
  }, [viewer, showJson]);

  return (
    <div className="rounded-2xl border border-[#c6dcec] bg-white p-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-1 [&_.tiptap_hr]:my-4 [&_.tiptap_hr]:border-[#c6dcec] [&_.tiptap_table]:w-full [&_.tiptap_table]:border-collapse [&_.tiptap_table]:border [&_.tiptap_table]:border-[#c6dcec] [&_.tiptap_th]:border [&_.tiptap_th]:border-[#c6dcec] [&_.tiptap_th]:bg-[#eaf5fb] [&_.tiptap_th]:px-2 [&_.tiptap_th]:py-1 [&_.tiptap_td]:border [&_.tiptap_td]:border-[#c6dcec] [&_.tiptap_td]:px-2 [&_.tiptap_td]:py-1">
      <EditorContent editor={ viewer } />
    </div>
  );
}

function ModalShowImage({ src, alt }: { src: string; alt: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    let isCancelled = false;

    const resolveSignedUrl = async () => {
      const key = extractS3KeyFromValue(src);

      if (!key) {
        if (!isCancelled) {
          setResolvedSrc(src);
        }
        return;
      }

      try {
        const response = await fetch("/api/s3-upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "download",
            fileName: key,
          }),
        });

        if (!response.ok) {
          if (!isCancelled) {
            setResolvedSrc(src);
          }
          return;
        }

        const body = await response.json();

        if (!isCancelled) {
          setResolvedSrc(body.url ?? src);
        }
      } catch {
        if (!isCancelled) {
          setResolvedSrc(src);
        }
      }
    };

    void resolveSignedUrl();

    return () => {
      isCancelled = true;
    };
  }, [src]);

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={ resolvedSrc } alt={ alt } className="h-full w-full object-cover" />;
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
        <span className={ cn("inline-flex cursor-default items-center gap-2 rounded-full px-3 py-0.5", triggerClassName, textClassName) }>
          { icon }
          { count.toLocaleString() }
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="font-app w-56 border-[#c6dcec] bg-white text-xs text-[#3f6576]">
        <p className="font-semibold text-[#15384a]">{ emptyLabel }</p>
        { memberNames.length > 0 ? (
          <ul className="mt-2 space-y-1">
            { memberNames.map((memberName) => (
              <li key={ memberName }>{ memberName }</li>
            )) }
          </ul>
        ) : (
          <p className="mt-2 text-[#5f7987]">No family members yet.</p>
        ) }
      </HoverCardContent>
    </HoverCard>
  );
}

export function TvHomePage({
  shows,
  member,
  initialGuidedLaunchPayload,
}: {
  shows: TvShow[];
  member: MemberKeyDetails;
  initialGuidedLaunchPayload?: GuidedTourLaunchPayload | null;
}) {
  const router = useRouter();
  const [isEngaging, startEngageTransition] = useTransition();
  const [selectedShowDetail, setSelectedShowDetail] = useState<TvShowDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isViewShowOpen, setIsViewShowOpen] = useState(false);
  const [showType, setShowType] = useState<"all" | "latest" | "top-rated">("all");
  const [dateScope, setDateScope] = useState<"everything" | "date-range">("everything");
  const [includeArchived, setIncludeArchived] = useState(false);

  const canAccessDraftShow = (showMemberId: number) => showMemberId === member.memberId || member.isFounder;

  const visibleShows = shows.filter((show) => (
    show.status === "published"
    || (show.status === "draft" && canAccessDraftShow(show.memberId))
    || (includeArchived && show.status === "archived")
  ));
  const latestShowRecords = [...visibleShows]
    .filter((show) => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      return new Date(show.updatedAt).getTime() >= twoMonthsAgo.getTime();
    })
    .sort((leftShow, rightShow) => +new Date(rightShow.updatedAt) - +new Date(leftShow.updatedAt))
    .slice(0, 8);

  const latestShows = latestShowRecords.map((show) => ({
    kind: "latest" as const,
    id: show.id,
    name: show.showTitle,
    date: formatShortDate(show.updatedAt),
    submitterName: show.submitterName,
    submitterImageUrl: show.submitterImageUrl ?? null,
    submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
    noRating: show.noRatingCount,
    commentsCount: show.commentCount,
    thumbsUp: show.thumbsUpCount,
    love: show.loveCount,
    imageSrc: show.showImageUrl ?? null,
    imageAlt: `${ show.showTitle } show image`,
    showSiteUrl: show.showSiteUrl ?? null,
    showSiteBackground: show.showSiteBackground,
    hasDiscussionThread: show.hasDiscussionThread,
  }));

  const topRatedShows = [...visibleShows]
    .filter((show) => (show.thumbsUpCount + show.loveCount) > 0)
    .sort((leftShow, rightShow) => {
      const leftScore = leftShow.thumbsUpCount + leftShow.loveCount;
      const rightScore = rightShow.thumbsUpCount + rightShow.loveCount;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return +new Date(rightShow.updatedAt) - +new Date(leftShow.updatedAt);
    })
    .slice(0, 8)
    .map((show) => ({
      kind: "top-rated" as const,
      id: show.id,
      name: show.showTitle,
      date: formatShortDate(show.updatedAt),
      submitterName: show.submitterName,
      submitterImageUrl: show.submitterImageUrl ?? null,
      submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
      noRating: show.noRatingCount,
      thumbsUp: show.thumbsUpCount,
      love: show.loveCount,
      commentsCount: show.commentCount,
      imageSrc: show.showImageUrl ?? null,
      imageAlt: `${ show.showTitle } show image`,
      showSiteUrl: show.showSiteUrl ?? null,
      showSiteBackground: show.showSiteBackground,
      hasDiscussionThread: show.hasDiscussionThread,
    }));

  const allShows = [...visibleShows]
    .sort((leftShow, rightShow) => leftShow.showTitle.localeCompare(rightShow.showTitle, undefined, { sensitivity: "base" }))
    .map((show) => ({
      kind: "all" as const,
      id: show.id,
      name: show.showTitle,
      date: formatShortDate(show.updatedAt),
      submitterName: show.submitterName,
      submitterImageUrl: show.submitterImageUrl ?? null,
      submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
      noRating: show.noRatingCount,
      commentsCount: show.commentCount,
      thumbsUp: show.thumbsUpCount,
      love: show.loveCount,
      imageSrc: show.showImageUrl ?? null,
      imageAlt: `${ show.showTitle } show image`,
      showSiteUrl: show.showSiteUrl ?? null,
      showSiteBackground: show.showSiteBackground,
      hasDiscussionThread: show.hasDiscussionThread,
    }));

  const stripTitle = showType === "all" ? "All TV Shows" : showType === "latest" ? "Latest TV Shows" : "Top Rated TV Shows";
  const stripDescription = showType === "all"
    ? dateScope === "date-range"
      ? "All shows in the selected date range, ordered by the most recently updated."
      : "All shows first, ordered by the most recently updated."
    : showType === "latest"
      ? dateScope === "date-range"
        ? "Newest shows in the selected date range."
        : "Newest shows overall."
      : dateScope === "date-range"
        ? "Top rated shows in the selected date range."
        : "Top rated shows based on total likes and loves.";
  const stripAccentClassName = showType === "all"
    ? "bg-[linear-gradient(135deg,#c6edf7,#fff6db)]"
    : showType === "latest"
      ? "bg-[linear-gradient(135deg,#b5e6f5,#fff3ce)]"
      : "bg-[linear-gradient(135deg,#ffdbae,#ffc4c8)]";

  const showFinderRows = visibleShows.map((show) => ({
    id: show.id,
    name: show.showTitle,
    updatedAt: show.updatedAt,
    genre: show.tagNamesByType.genre?.[0] ?? "-",
    adjective: show.tagNamesByType.adjective?.[0] ?? "-",
    channel: show.tagNamesByType.channel?.[0] ?? "Unknown",
    seasons: show.seasonCount,
    addedBy: show.submitterName,
    thumbsUp: show.thumbsUpCount,
    love: show.loveCount,
    comments: show.commentCount,
    hasDiscussionThread: show.hasDiscussionThread,
  }));

  const [searchValue, setSearchValue] = useState("");
  const [filterWithDiscussionThreads, setFilterWithDiscussionThreads] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return toDateInputValue(threeMonthsAgo);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [appliedStartDate, setAppliedStartDate] = useState(startDate);
  const [appliedEndDate, setAppliedEndDate] = useState(endDate);
  const [selectedShow, setSelectedShow] = useState(showFinderRows[0]?.id ?? 0);
  const [showSelectionRevision, setShowSelectionRevision] = useState(0);
  const deferredSearchValue = useDeferredValue(searchValue);

  useEffect(() => {
    const flushQueuedShowComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFeatureComments().filter((item) => item.kind === "show");

      for (const queuedComment of queuedComments) {
        const result = await addShowCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFeatureComment(queuedComment.payload.clientRequestId);
        }

        if (selectedShow === queuedComment.payload.showId) {
          setSelectedShowDetail(result.show);
        }
      }
    };

    void flushQueuedShowComments();

    const handleSync = () => {
      void flushQueuedShowComments();
    };

    window.addEventListener("online", handleSync);
    window.addEventListener(getPwaSyncNowEventName(), handleSync);

    return () => {
      window.removeEventListener("online", handleSync);
      window.removeEventListener(getPwaSyncNowEventName(), handleSync);
    };
  }, [selectedShow]);

  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;

  const filteredShows = showFinderRows.filter((show) => {
    const updatedAt = new Date(show.updatedAt);

    if (startDateValue && updatedAt < startDateValue) {
      return false;
    }

    if (endDateValue && updatedAt > endDateValue) {
      return false;
    }

    if (filterWithDiscussionThreads && !show.hasDiscussionThread) {
      return false;
    }

    const query = deferredSearchValue.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return [show.name, show.genre, show.adjective, show.channel, show.addedBy]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const filteredShowIds = new Set(filteredShows.map((show) => show.id));

  const filteredLatestShows = [...visibleShows]
    .filter((show) => filteredShowIds.has(show.id))
    .sort((leftShow, rightShow) => +new Date(rightShow.updatedAt) - +new Date(leftShow.updatedAt))
    .slice(0, 8)
    .map((show) => ({
      kind: "latest" as const,
      id: show.id,
      name: show.showTitle,
      date: formatShortDate(show.updatedAt),
      submitterName: show.submitterName,
      submitterImageUrl: show.submitterImageUrl ?? null,
      submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
      noRating: show.noRatingCount,
      commentsCount: show.commentCount,
      thumbsUp: show.thumbsUpCount,
      love: show.loveCount,
      imageSrc: show.showImageUrl ?? null,
      imageAlt: `${ show.showTitle } show image`,
      showSiteUrl: show.showSiteUrl ?? null,
      showSiteBackground: show.showSiteBackground,
      hasDiscussionThread: show.hasDiscussionThread,
    }));

  const filteredTopRatedShows = [...visibleShows]
    .filter((show) => filteredShowIds.has(show.id) && (show.thumbsUpCount + show.loveCount) > 0)
    .sort((leftShow, rightShow) => {
      const leftScore = leftShow.thumbsUpCount + leftShow.loveCount;
      const rightScore = rightShow.thumbsUpCount + rightShow.loveCount;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return +new Date(rightShow.updatedAt) - +new Date(leftShow.updatedAt);
    })
    .slice(0, 8)
    .map((show) => ({
      kind: "top-rated" as const,
      id: show.id,
      name: show.showTitle,
      date: formatShortDate(show.updatedAt),
      submitterName: show.submitterName,
      submitterImageUrl: show.submitterImageUrl ?? null,
      submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
      noRating: show.noRatingCount,
      thumbsUp: show.thumbsUpCount,
      love: show.loveCount,
      commentsCount: show.commentCount,
      imageSrc: show.showImageUrl ?? null,
      imageAlt: `${ show.showTitle } show image`,
      showSiteUrl: show.showSiteUrl ?? null,
      showSiteBackground: show.showSiteBackground,
      hasDiscussionThread: show.hasDiscussionThread,
    }));

  const filteredAllShows = [...visibleShows]
    .filter((show) => filteredShowIds.has(show.id))
    .sort((leftShow, rightShow) => leftShow.showTitle.localeCompare(rightShow.showTitle, undefined, { sensitivity: "base" }))
    .map((show) => ({
      kind: "all" as const,
      id: show.id,
      name: show.showTitle,
      date: formatShortDate(show.updatedAt),
      submitterName: show.submitterName,
      submitterImageUrl: show.submitterImageUrl ?? null,
      submitterLikenessDegree: show.memberId === member.memberId ? null : show.submitterLikenessDegree,
      noRating: show.noRatingCount,
      commentsCount: show.commentCount,
      thumbsUp: show.thumbsUpCount,
      love: show.loveCount,
      imageSrc: show.showImageUrl ?? null,
      imageAlt: `${ show.showTitle } show image`,
      showSiteUrl: show.showSiteUrl ?? null,
      showSiteBackground: show.showSiteBackground,
      hasDiscussionThread: show.hasDiscussionThread,
    }));

  const stripItems = showType === "all"
    ? filteredAllShows
    : showType === "latest"
      ? filteredLatestShows
      : filteredTopRatedShows;

  useEffect(() => {
    if (!selectedShow) {
      return;
    }

    let isCancelled = false;

    startEngageTransition(async () => {
      const result = await getShowDetailAction({ showId: selectedShow });

      if (isCancelled) {
        return;
      }

      if (!result.success) {
        setSelectedShowDetail(null);
        return;
      }

      setSelectedShowDetail(result.show);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedShow, showSelectionRevision]);

  // const selectedShowName = showFinderRows.find((show) => show.id === selectedShow)?.name ?? "";
  const selectedShowBasic =
    (selectedShowDetail?.id === selectedShow
      ? selectedShowDetail
      : shows.find((show) => show.id === selectedShow))
    ?? shows[0]
    ?? null;
  const canEditSelectedShow = Boolean(selectedShowBasic && (selectedShowBasic.memberId === member.memberId || member.isFounder));
  const canReactToSelectedShow = Boolean(selectedShowBasic && selectedShowBasic.memberId !== member.memberId);
  const canCommentOnSelectedShow = canReactToSelectedShow;
  const selectedShowNoRatingCount = selectedShowDetail?.id === selectedShow
    ? selectedShowDetail.noRatingCount
    : canReactToSelectedShow
      ? (selectedShowBasic?.noRatingCount ?? 0)
      : 0;
  const selectedShowThumbsUpCount = selectedShowDetail?.id === selectedShow
    ? selectedShowDetail.thumbsUpCount
    : canReactToSelectedShow
      ? (selectedShowBasic?.thumbsUpCount ?? 0)
      : 0;
  const selectedShowLoveCount = selectedShowDetail?.id === selectedShow
    ? selectedShowDetail.loveCount
    : canReactToSelectedShow
      ? (selectedShowBasic?.loveCount ?? 0)
      : 0;

  function handleSelectShow(showId: number) {
    setCommentText("");
    const show = shows.find((record) => record.id === showId);

    if (show) {
      setSelectedShow(showId);
      setSelectedShowDetail(null);
      setShowSelectionRevision((prev) => prev + 1);
    }
  }

  function handleOpenShowFromCard(showId: number) {
    handleSelectShow(showId);
    setIsViewShowOpen(true);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function handleToggleLike(likenessDegree: number) {
    if (!selectedShowBasic) {
      return;
    }

    if (selectedShowBasic.memberId === member.memberId) {
      toast.error("You cannot react to your own show posting.");
      return;
    }

    startEngageTransition(async () => {
      const result = await toggleShowLikeAction({
        showId: selectedShowBasic.id,
        likenessDegree,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setSelectedShowDetail(result.show);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedShowBasic) {
      return;
    }

    if (!canCommentOnSelectedShow) {
      toast.error("You cannot comment on your own show posting.");
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);

    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const payload = {
        showId: selectedShowBasic.id,
        commentText: normalizedComment,
        clientRequestId: createClientRequestId("show-comment"),
      };
      const result = await addShowCommentAction(payload);

      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFeatureComment({
            kind: "show",
            payload,
            itemTitle: selectedShowBasic.showTitle,
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

      setSelectedShowDetail(result.show);
      setCommentText("");
      toast.success(result.message);
    });
  }

  return (
    <FilterSidebarProvider palette={ tvFilterPalette }>
      <FilterSidebar title="Show Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by show, genre, adjective, channel, or family member"
          ariaLabel="Search TV shows"
        />
        <FilterSidebarDateScope
          radioName="tv-date-scope"
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
        <FilterSidebarGroup id="tv-show-type" label="Show Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="tv-show-type" value="all" checked={ showType === "all" } onChange={ () => setShowType("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="tv-show-type" value="latest" checked={ showType === "latest" } onChange={ () => setShowType("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="tv-show-type" value="top-rated" checked={ showType === "top-rated" } onChange={ () => setShowType("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithDiscussionThreads } onChange={ setFilterWithDiscussionThreads }>Discussions</FilterSidebarCheckbox>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app h-full min-w-0 flex-1 px-4 pb-8 pt-2 sm:px-6 sm:pt-4 lg:px-8">
        <div id="tv-show-welcome" className="mx-auto max-w-7xl space-y-3 sm:space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(11,47,66,0.95),rgba(21,98,123,0.86)_56%,rgba(106,177,198,0.78))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(8,34,50,0.95)] sm:px-8 sm:py-8 lg:px-10">
          <div className="flex flex-col gap-3 sm:gap-5">
            <div className="max-w-3xl">
              <p className="text-[1rem] font-bold uppercase tracking-[0.28em] text-[#b9f1ff]">
                Family TV Room
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <div id="tv-return-home">
                  <Link
                    href="/"
                    className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d9f5ff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                  >
                    <HouseHeart className="font-app mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                    Go Home
                  </Link>
                </div>
                <Link
                  href="/tv/templates"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d9f5ff] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  <Edit3 className="mr-1 size-3 sm:size-3.5" />
                  Templates
                </Link>
              </div>
              {/* <h1 className="mt-3 text-base font-black leading-snug tracking-tight sm:mt-4 sm:text-3xl">
                See what TV shows your family&apos;s watching.
              </h1> */}
              {/* <p className="mt-3 max-w-2xl text-sm leading-7 text-[#b9f1ff] sm:text-base">
                Comment on their favorites, add your own reviews, and find your next binge together.
              </p> */}

            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/82 shadow-[0_24px_70px_-40px_rgba(9,44,62,0.75)] backdrop-blur">
            <div className="border-b border-[#d7ebf3] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(236,249,255,0.85))] px-4 py-3.5 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div id="tv-show-finder">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#45829a]">
                      TV Directory
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#5f7987]">
                      <h2 className="text-2xl font-black tracking-tight text-[#15384a]">Show Finder</h2>
                      <FeatureFaqHelp
                        href="/feature-faq?category=TV%20Reviews"
                        buttonClassName="h-4 w-4 md:h-7 md:w-7 border-[#c9e2ec] bg-gradient-to-b from-[#f7fcff] to-[#dff2f9] text-[#2a819d] shadow-[0_8px_18px_rgba(42,129,157,0.2)] group-hover:shadow-[0_12px_26px_rgba(42,129,157,0.3)]"
                        iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#2a819d]"
                        tooltipClassName="bg-[#15384a] text-[#ecf9ff]"
                      />
                      <EditPostIcon tooltip="Filter Shows" tooltipClassName="bg-[#15384a] text-[#ecf9ff]">
                        <FilterSidebarTrigger ariaLabel="Toggle show filters" />
                      </EditPostIcon>
                      <EditPostIcon tooltip="View Show" tooltipClassName="bg-[#15384a] text-[#ecf9ff]">
                        <Button type="button" onClick={ () => setIsViewShowOpen(true) } disabled={ !selectedShowBasic } className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#15384a] hover:bg-[#dff2f9] disabled:opacity-50 sm:px-3" aria-label="View selected show"><Eye className="size-3.5" /><span className="hidden sm:inline">View</span></Button>
                      </EditPostIcon>
                      <EditPostIcon tooltip="Add Show" tooltipClassName="bg-[#15384a] text-[#ecf9ff]">
                        <Button type="button" variant="outline" asChild className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#15384a] hover:bg-[#dff2f9] hover:text-[#15384a] sm:px-3"><Link href="/tv/add-show" aria-label="Add new show"><Plus className="size-3.5" /><span className="hidden sm:inline">Add</span></Link></Button>
                      </EditPostIcon>
                      <EditPostIcon tooltip="Edit Show" tooltipClassName="bg-[#15384a] text-[#ecf9ff]">
                        <Button type="button" variant="outline" onClick={ () => router.push(`/tv/edit-show/${ selectedShow }`) } disabled={ !canEditSelectedShow } className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#c9e2ec] bg-[#f6fbfe] px-2 text-xs font-semibold text-[#15384a] hover:bg-[#dff2f9] hover:text-[#15384a] disabled:opacity-50 sm:px-3" aria-label="Edit selected show"><Edit3 className="size-3.5" /><span className="hidden sm:inline">Edit</span></Button>
                      </EditPostIcon>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <div className="px-4 pb-2 pt-1 sm:px-6 sm:py-5">
              { stripItems.length === 0 ? (
                <div className="rounded-[1.4rem] border border-[#d7ebf3] bg-white px-4 py-8 text-center text-sm text-[#5f7987]">
                  No shows match that search yet.
                </div>
              ) : (
                <TvScrollStrip
                  title={ stripTitle }
                  description={ stripDescription }
                  items={ stripItems }
                  accentClassName={ stripAccentClassName }
                  selectedShowId={ selectedShow }
                  onSelectShow={ handleSelectShow }
                  onOpenShow={ handleOpenShowFromCard }
                />
              ) }
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/90 shadow-[0_24px_70px_-40px_rgba(9,44,62,0.75)] backdrop-blur">
            <div className="border-b border-[#d7ebf3] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(236,249,255,0.86))] px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div id="tv-show-reactions">
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#45829a]">
                    Show Reactions
                  </p>
                  <p className="mt-2 max-w-2xl text-xs leading-6 text-[#5f7987]">
                    React to this show and post comments your family can see.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              { selectedShowBasic ? (
                <>
                    <div className="space-y-3 rounded-[1.4rem] border border-[#d7ebf3] bg-[#f5fbff] p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          onClick={ () => handleToggleLike(-1) }
                          disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                          className="rounded-full bg-[#5c6c76] text-white hover:bg-[#4c5961]"
                          aria-label={ selectedShowDetail?.likenessDegree === -1 ? "Remove thumbs down" : "Add thumbs down" }
                        >
                          <ThumbsDown className={ `size-4 ${ selectedShowDetail?.likenessDegree === -1 ? "fill-white" : "" }` } />
                        </Button>
                        <Button
                          type="button"
                          onClick={ () => handleToggleLike(1) }
                          disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                          className="rounded-full bg-[#2d87a8] text-white hover:bg-[#256e89]"
                          aria-label={ selectedShowDetail?.likenessDegree === 1 ? "Remove thumbs up" : "Add thumbs up" }
                        >
                          <ThumbsUp className={ `size-4 ${ selectedShowDetail?.likenessDegree === 1 ? "fill-white" : "" }` } />
                        </Button>
                        <Button
                          type="button"
                          onClick={ () => handleToggleLike(2) }
                          disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                          className="rounded-full bg-[#cf3f7f] text-white hover:bg-[#aa3368]"
                          aria-label={ selectedShowDetail?.likenessDegree === 2 ? "Remove love" : "Add love" }
                        >
                          <Heart className={ `size-4 ${ selectedShowDetail?.likenessDegree === 2 ? "fill-white" : "" }` } />
                        </Button>
                      </div>
                      { !canReactToSelectedShow && selectedShowBasic ? (
                        <p className="text-xs text-[#5f7987]">
                          You cannot react to your own show. Ask another family member to react to it.
                        </p>
                      ) : null }
                      <div className="flex flex-wrap items-center gap-4">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#5c6c76]">
                          <ThumbsDown className="size-4 text-[#5c6c76]" />
                          { selectedShowNoRatingCount.toLocaleString() }
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#285b73]">
                          <ThumbsUp className="size-4 text-[#2d87a8]" />
                          { selectedShowThumbsUpCount.toLocaleString() }
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#8f2f58]">
                          <Heart className="size-4 fill-[#cf3f7f] text-[#cf3f7f]" />
                          { selectedShowLoveCount.toLocaleString() }
                        </span>
                      </div>
                    </div>

                </>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-[#d7ebf3] bg-[#f8fcff] px-6 py-10 text-center text-[#5f7987]">
                  <MessageSquareText className="mx-auto mb-3 size-10 text-[#6ea8be]" />
                  <p className="text-lg font-semibold text-[#15384a]">Select a show to react and discuss.</p>
                  <p className="mt-2 text-sm">Choose a show from the finder list to react and browse discussions.</p>
                </div>
              ) }
            </div>
          </div>
        </div>
      </div>

      <Dialog open={ isViewShowOpen } onOpenChange={ setIsViewShowOpen }>
        <DialogContent className="border-[#c6dcec] bg-[#f5fbff] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-[#15384a]">{ selectedShowBasic?.showTitle ?? "Show" }</DialogTitle>
            <DialogDescription className="text-[#5f7987]">
              Full show details and family notes.
            </DialogDescription>
          </DialogHeader>

          { selectedShowBasic ? (
            <div className="max-h-[90vh] space-y-4 overflow-auto pr-1">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                <ShowViewer showJson={ selectedShowBasic.showJson } />

                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-[#c6dcec] bg-white">
                    <div className="relative aspect-16/10 overflow-hidden">
                      { selectedShowBasic.showImageUrl ? (
                        <ModalShowImage
                          src={ selectedShowBasic.showImageUrl }
                          alt={ `${ selectedShowBasic.showTitle } show image` }
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#173444] px-4">
                          <span className="text-center text-sm font-semibold text-white/80">No show image available.</span>
                        </div>
                      ) }
                      <span className="absolute left-3 top-3 inline-flex" title={ selectedShowBasic.submitterName }>
                        <MemberAvatar
                          imageUrl={ selectedShowBasic.submitterImageUrl }
                          firstName={ selectedShowBasic.submitterName }
                          sizeClassName="h-10 w-10"
                          chromeClassName="border-2 border-white shadow-md"
                        />
                      </span>
                    </div>
                  </div>

                  { (!selectedShowBasic.showSiteUrl || selectedShowBasic.showImageUrl) ? (
                    <div className="rounded-2xl border border-[#c6dcec] bg-white p-4">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#45829a]">Image Credit</p>
                      <p className="mt-2 text-sm leading-6 text-[#3f6576] wrap-break-word">
                        { selectedShowBasic.showImageCredit || "No image credit provided." }
                      </p>
                    </div>
                  ) : null }

                  { selectedShowBasic.showSiteUrl ? (
                    <div className="rounded-2xl border border-[#c6dcec] bg-white p-4">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#45829a]">Official Site</p>
                      <a
                        href={ selectedShowBasic.showSiteUrl }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[#1a6a8a] underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-4" />
                        { selectedShowBasic.showSiteUrl.includes("imdb.com") ? "View on IMDb" : "View on YouTube" }
                      </a>
                    </div>
                  ) : null }

                  <div className="rounded-2xl border border-[#c6dcec] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#45829a]">Details</p>
                    <div className="mt-2 space-y-1 text-sm leading-5 text-[#3f6576]">
                      <p><span className="font-semibold text-[#15384a]">Submitter:</span> { selectedShowBasic.submitterName }</p>
                      <p><span className="font-semibold text-[#15384a]">Updated:</span> { formatDate(selectedShowBasic.updatedAt) }</p>
                      <p><span className="font-semibold text-[#15384a]">Years:</span> { selectedShowBasic.showFirstYear } - { selectedShowBasic.showLastYear }</p>
                      <p><span className="font-semibold text-[#15384a]">Seasons:</span> { selectedShowBasic.seasonCount }</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#c6dcec] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#45829a]">Tags</p>
                    { getShowTagNames(selectedShowBasic).length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-[#3f6576]">
                        { getShowTagNames(selectedShowBasic).map((tagName) => (
                          <span key={ tagName } className="rounded-full bg-[#e3f1f8] px-2.5 py-1 text-xs font-semibold text-[#1a6a8a]">
                            { tagName }
                          </span>
                        )) }
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#5f7987]">No tags added.</p>
                    ) }
                  </div>

                  <div className="rounded-2xl border border-[#c6dcec] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#45829a]">Reactions</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(-1) }
                        disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                        className="rounded-full bg-[#5c6c76] text-white hover:bg-[#4c5961]"
                        aria-label={ selectedShowDetail?.likenessDegree === -1 ? "Remove thumbs down" : "Add thumbs down" }
                      >
                        <ThumbsDown className={ `size-4 ${ selectedShowDetail?.likenessDegree === -1 ? "fill-white" : "" }` } />
                      </Button>
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(1) }
                        disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                        className="rounded-full bg-[#2d87a8] text-white hover:bg-[#256e89]"
                        aria-label={ selectedShowDetail?.likenessDegree === 1 ? "Remove thumbs up" : "Add thumbs up" }
                      >
                        <ThumbsUp className={ `size-4 ${ selectedShowDetail?.likenessDegree === 1 ? "fill-white" : "" }` } />
                      </Button>
                      <Button
                        type="button"
                        onClick={ () => handleToggleLike(2) }
                        disabled={ !selectedShowBasic || isEngaging || !canReactToSelectedShow }
                        className="rounded-full bg-[#cf3f7f] text-white hover:bg-[#aa3368]"
                        aria-label={ selectedShowDetail?.likenessDegree === 2 ? "Remove love" : "Add love" }
                      >
                        <Heart className={ `size-4 ${ selectedShowDetail?.likenessDegree === 2 ? "fill-white" : "" }` } />
                      </Button>
                      { !canReactToSelectedShow ? (
                        <p className="text-xs text-[#5f7987]">You cannot react to your own show. Ask another family member to react to it.</p>
                      ) : null }
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm font-semibold text-[#285b73]">
                      <ReactionMemberHoverCard
                        icon={ <ThumbsDown className="size-4 text-[#5c6c76]" /> }
                        count={ selectedShowNoRatingCount }
                        memberNames={ selectedShowDetail?.noRatingMemberNames ?? [] }
                        triggerClassName="bg-[#eef3f6]"
                        textClassName="text-[#5c6c76]"
                        emptyLabel="Family members who disliked this show"
                      />
                      <ReactionMemberHoverCard
                        icon={ <ThumbsUp className="size-4 text-[#2d87a8]" /> }
                        count={ selectedShowThumbsUpCount }
                        memberNames={ selectedShowDetail?.thumbsUpMemberNames ?? [] }
                        triggerClassName="bg-[#edf7fb]"
                        emptyLabel="Family members who liked this show"
                      />
                      <ReactionMemberHoverCard
                        icon={ <Heart className="size-4 fill-[#cf3f7f] text-[#cf3f7f]" /> }
                        count={ selectedShowLoveCount }
                        memberNames={ selectedShowDetail?.loveMemberNames ?? [] }
                        triggerClassName="bg-[#fff0f7]"
                        textClassName="text-[#8f2f58]"
                        emptyLabel="Family members who loved this show"
                      />
                      <span className="inline-flex items-center gap-2 rounded-full bg-[#edf7fb] px-3 py-0.5">
                        <MessageSquareText className="size-4 text-[#2d87a8]" />
                        { selectedShowDetail?.commentCount ?? selectedShowBasic.commentCount ?? 0 }
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#d7ebf3] bg-[#f5fbff] p-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#45829a]">Family Comments</p>
                  <p className="text-xs text-[#5f7987]">Share your thoughts about this show with your family.</p>
                </div>

                <div className="space-y-2">
                  { selectedShowDetail?.id === selectedShow && selectedShowDetail.showComments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#d7ebf3] bg-white px-3 py-2 text-sm text-[#5f7987]">
                      No comments yet. Be the first family member to add one.
                    </p>
                  ) : selectedShowDetail?.id !== selectedShow ? (
                    <p className="rounded-2xl border border-dashed border-[#d7ebf3] bg-white px-3 py-2 text-sm text-[#5f7987]">
                      Loading comments...
                    </p>
                  ) : (
                    (selectedShowDetail?.showComments ?? []).map((comment) => (
                      <article key={ comment.id } className="rounded-2xl border border-[#d7ebf3] bg-white px-3 py-3 text-sm text-[#3f6576]">
                        <TiptapRenderer contentJson={ comment.commentJson } />
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#4f7384]">
                          { comment.commenterName } · { formatCreatedAt(comment.createdAt) }
                        </p>
                      </article>
                    ))
                  ) }
                </div>

                { canCommentOnSelectedShow ? (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#15384a]" htmlFor="show-comment-input-dialog">
                      Add Comment
                    </label>
                    <div id="show-comment-input-dialog">
                      <TipTapCommentEditor
                        value={ commentText }
                        onChange={ setCommentText }
                        placeholder="What did you think about this show?"
                        disabled={ !selectedShowBasic || isEngaging }
                        toolbarClassName="border-[#d7ebf3] bg-[#eef8fd]"
                        editorClassName="border-[#d7ebf3] text-[#15384a]"
                        buttonClassName="border-[#c9e2ec] text-[#24536a]"
                        activeButtonClassName="border-[#2d87a8] bg-[#dff2f9] text-[#15384a]"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={ handleAddComment }
                        disabled={ !selectedShowBasic || isEngaging || isSerializedTipTapDocumentEmpty(commentText) }
                        className="rounded-full bg-[#2d87a8] text-white hover:bg-[#256e89]"
                      >
                        Post Comment
                      </Button>
                    </div>
                  </div>
                ) : null }

                <div className="space-y-3 rounded-4xl border border-[#d7ebf3] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#5f7987]">
                        <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#45829a]">Discussion Threads</p>
                        <FeatureFaqHelp
                          href="/feature-faq?category=Discussion%20Groups"
                          buttonClassName="h-4 w-4 md:h-7 md:w-7 rounded-xl border-[#c9e2ec] bg-gradient-to-b from-[#f7fcff] to-[#dff2f9] text-[#2a819d] shadow-[0_8px_18px_rgba(42,129,157,0.2)] group-hover:shadow-[0_12px_26px_rgba(42,129,157,0.3)]"
                          iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#2a819d]"
                          tooltipClassName="bg-[#15384a] text-[#ecf9ff]"
                        />
                      </div>
                      <p className="text-xs text-[#5f7987]">Follow the conversation that belongs to this show.</p>
                    </div>
                    <StartDiscussionDialog
                      targetType="show"
                      targetId={ selectedShowBasic.id }
                      topicLabel={ `${ selectedShowBasic.showTitle } Discussion ${ (selectedShowDetail?.id === selectedShow
                        ? selectedShowDetail.discussionThreads.length
                        : 0) + 1 }` }
                      revalidatePaths={ ["/tv"] }
                      onSuccessRoute="/tv/discussions/:threadId"
                      disabled={ isEngaging || selectedShowDetail?.id !== selectedShow }
                      triggerLabel="Add Discussion"
                      triggerClassName="rounded-full bg-[#2d87a8] px-4 text-xs font-semibold text-white hover:bg-[#256e89]"
                    />
                  </div>

                  { selectedShowDetail?.id !== selectedShow ? (
                    <p className="rounded-2xl border border-dashed border-[#d7ebf3] bg-[#f8fcff] px-3 py-2 text-sm text-[#5f7987]">
                      Loading discussion threads...
                    </p>
                  ) : selectedShowDetail.discussionThreads.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#d7ebf3] bg-[#f8fcff] px-3 py-3 text-sm text-[#5f7987]">
                      <p>No discussion threads have been added for this show yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      { selectedShowDetail.discussionThreads.map((discussionThread) => (
                        <article key={ discussionThread.id } className="rounded-2xl border border-[#d7ebf3] bg-[#f8fcff] px-4 py-4 text-sm text-[#3f6576] shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1 flex-1">
                              <p className="text-base font-bold leading-snug text-[#15384a]">{ discussionThread.discussTopic }</p>
                              <p className="text-xs uppercase tracking-[0.16em] text-[#4f7384]">
                                { discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 shrink-0">
                              { discussionThread.dislikeCount > 0 || discussionThread.likeCount > 0 || discussionThread.loveCount > 0 ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  { discussionThread.dislikeCount > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#efebe8] px-2 py-1 text-[0.65rem] font-semibold text-[#4f433d]">
                                      <ThumbsDown className="size-3" />
                                      { discussionThread.dislikeCount }
                                    </span>
                                  ) }
                                  { discussionThread.likeCount > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#e4f4fb] px-2 py-1 text-[0.65rem] font-semibold text-[#1f5a70]">
                                      <ThumbsUp className="size-3" />
                                      { discussionThread.likeCount }
                                    </span>
                                  ) }
                                  { discussionThread.loveCount > 0 && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fde4ee] px-2 py-1 text-[0.65rem] font-semibold text-[#aa3368]">
                                      <Heart className="size-3 fill-current" />
                                      { discussionThread.loveCount }
                                    </span>
                                  ) }
                                </div>
                              ) : null }

                              <Button
                                type="button"
                                variant="outline"
                                asChild
                                className="shrink-0 rounded-full border-[#c9e2ec] bg-white px-4 text-xs font-semibold text-[#15384a] hover:bg-[#dff2f9]"
                              >
                                <Link href={ `/tv/discussions/${ discussionThread.id }` }>
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
            </div>
          ) : null }
        </DialogContent>
      </Dialog>
      </section>
      <GuidedTourLauncher initialPayload={ initialGuidedLaunchPayload } tourKey="tv_tour" />
    </FilterSidebarProvider>
  );
}
