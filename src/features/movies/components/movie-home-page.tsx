"use client";

import type { JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { Edit3, Eye, ExternalLink, Heart, HouseHeart, MessageSquareText, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addMovieCommentAction,
  getMovieDetailAction,
  toggleMovieLikeAction,
} from "@/app/(features)/(movies)/movies/actions";
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
import { MovieDetail, MovieRecord } from "@/components/db/types/movies";
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
import { MovieScrollStrip } from "@/features/movies/components/movie-scroll-strip";
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import { clearQueuedFeatureComment, createClientRequestId, getPwaSyncNowEventName, isBrowserOnline, queueFeatureComment, readQueuedFeatureComments } from "@/lib/pwa-background-sync";
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

const movieFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#fff8f2",
  sidebarForeground: "#5c2e1a",
  sidebarBorder: "#f0d9c4",
  label: "#a85a3a",
  muted: "#8b5a3c",
  inputBorder: "#e8c4a0",
  inputText: "#5c2e1a",
  chipBorder: "#e8c4a0",
  chipText: "#5c2e1a",
  chipHoverBackground: "#fffaf5",
  checkBorder: "#d4a574",
  checkboxText: "#8b5a3c",
  accent: "#b8581a",
  accentHoverBackground: "#9d4615",
  triggerBorder: "#e8c4a0",
  triggerBackground: "#fff6ef",
  triggerText: "#7b3306",
  triggerHoverBackground: "#ffefdf",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatStripDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
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

function getMovieDocument(movieJson?: string): JSONContent {
  if (!movieJson) {
    return createEmptyTipTapDocument();
  }

  const parsed = parseSerializedTipTapDocument(movieJson);
  return parsed.success ? parsed.content : createEmptyTipTapDocument();
}

function getMovieTagNames(movie: MovieRecord) {
  return [
    ...(movie.tagNamesByType.genre ?? []),
    ...(movie.tagNamesByType.adjective ?? []),
    ...(movie.tagNamesByType.channel ?? []),
  ].filter((tagName, index, tagNames) => tagNames.indexOf(tagName) === index);
}

function MovieViewer({ movieJson }: { movieJson?: string }) {
  const viewer = useEditor({
    editable: false,
    extensions: [
      StarterKit,
      Underline,
      LinkExtension.configure({ autolink: true, defaultProtocol: "https", openOnClick: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: getMovieDocument(movieJson),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-112 text-[#4b2a18] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!viewer) {
      return;
    }

    viewer.commands.setContent(getMovieDocument(movieJson));
  }, [viewer, movieJson]);

  return (
    <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-1 [&_.tiptap_hr]:my-4 [&_.tiptap_hr]:border-[#f0d9c4] [&_.tiptap_table]:w-full [&_.tiptap_table]:border-collapse [&_.tiptap_table]:border [&_.tiptap_table]:border-[#f0d9c4] [&_.tiptap_th]:border [&_.tiptap_th]:border-[#f0d9c4] [&_.tiptap_th]:bg-[#fff1e8] [&_.tiptap_th]:px-2 [&_.tiptap_th]:py-1 [&_.tiptap_td]:border [&_.tiptap_td]:border-[#f0d9c4] [&_.tiptap_td]:px-2 [&_.tiptap_td]:py-1">
      <EditorContent editor={ viewer } />
    </div>
  );
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
    <span className={ `inline-flex items-center gap-2 rounded-full px-3 py-0.5 ${ triggerClassName } ${ textClassName ?? "" }` }>
      <HoverCard openDelay={ 120 } closeDelay={ 100 }>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center"
            aria-label={ emptyLabel }
            onClick={ (event) => {
              event.preventDefault();
              event.stopPropagation();
            } }
          >
            { icon }
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="font-app w-56 border-[#f0d9c4] bg-white text-xs text-[#734f3a]">
          <p className="font-semibold text-[#5c2e1a]">{ emptyLabel }</p>
          { memberNames.length > 0 ? (
            <ul className="mt-2 space-y-1">
              { memberNames.map((memberName) => (
                <li key={ memberName }>{ memberName }</li>
              )) }
            </ul>
          ) : (
            <p className="mt-2 text-[#8b5a3c]">No family members yet.</p>
          ) }
        </HoverCardContent>
      </HoverCard>
      <span className="pointer-events-none select-none">{ count.toLocaleString() }</span>
    </span>
  );
}

export function MovieHomePage({
  movies,
  member,
  initialGuidedLaunchPayload,
}: {
  movies: MovieRecord[];
  member: MemberKeyDetails;
  initialGuidedLaunchPayload?: GuidedTourLaunchPayload | null;
}) {
  const router = useRouter();
  const [isEngaging, startEngageTransition] = useTransition();
  const [selectedMovieDetail, setSelectedMovieDetail] = useState<MovieDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isViewMovieOpen, setIsViewMovieOpen] = useState(false);
  const [movieStripMode, setMovieStripMode] = useState<"all" | "latest" | "top-rated">("all");
  const [dateScope, setDateScope] = useState<"everything" | "date-range">("everything");
  const [searchValue, setSearchValue] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const canAccessDraftMovie = (movieMemberId: number) => movieMemberId === member.memberId || member.isFounder;
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return toDateInputValue(threeMonthsAgo);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [appliedStartDate, setAppliedStartDate] = useState(startDate);
  const [appliedEndDate, setAppliedEndDate] = useState(endDate);
  const visibleMovies = movies.filter((movie) => (
    movie.status === "published"
    || (movie.status === "draft" && canAccessDraftMovie(movie.memberId))
    || (includeArchived && movie.status === "archived")
  ));
  const [selectedMovie, setSelectedMovie] = useState(visibleMovies[0]?.id ?? 0);
  const [filterWithDiscussionThreads, setFilterWithDiscussionThreads] = useState(false);
  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;

  const filteredFinderMovies = visibleMovies.filter((movie) => {
    const updatedAt = new Date(movie.updatedAt);

    if (startDateValue && updatedAt < startDateValue) {
      return false;
    }

    if (endDateValue && updatedAt > endDateValue) {
      return false;
    }

    if (filterWithDiscussionThreads && !movie.hasDiscussionThread) {
      return false;
    }

    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      movie.movieTitle,
      movie.tagNamesByType.genre?.[0] ?? "",
      movie.tagNamesByType.adjective?.[0] ?? "",
      movie.tagNamesByType.channel?.[0] ?? "",
      movie.submitterName,
    ].join(" ").toLowerCase().includes(query);
  });

  useEffect(() => {
    const flushQueuedMovieComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFeatureComments().filter((item) => item.kind === "movie");

      for (const queuedComment of queuedComments) {
        const result = await addMovieCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFeatureComment(queuedComment.payload.clientRequestId);
        }

        if (selectedMovie === queuedComment.payload.movieId) {
          setSelectedMovieDetail(result.movie);
        }
      }
    };

    void flushQueuedMovieComments();

    const handleSync = () => {
      void flushQueuedMovieComments();
    };

    window.addEventListener("online", handleSync);
    window.addEventListener(getPwaSyncNowEventName(), handleSync);

    return () => {
      window.removeEventListener("online", handleSync);
      window.removeEventListener(getPwaSyncNowEventName(), handleSync);
    };
  }, [selectedMovie]);

  const latestMovies = [...filteredFinderMovies]
    .filter((movie) => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      return new Date(movie.updatedAt).getTime() >= twoMonthsAgo.getTime();
    })
    .sort((leftMovie, rightMovie) => +new Date(rightMovie.updatedAt) - +new Date(leftMovie.updatedAt))
    .slice(0, 8)
    .map((movie) => ({
      kind: "latest" as const,
      id: movie.id,
      name: movie.movieTitle,
      date: formatStripDate(movie.updatedAt),
      submitterName: movie.submitterName,
      submitterImageUrl: movie.submitterImageUrl ?? null,
      submitterLikenessDegree: movie.memberId === member.memberId ? null : movie.submitterLikenessDegree,
      noRating: movie.noRatingCount,
      commentsCount: movie.commentCount,
      thumbsUp: movie.thumbsUpCount,
      love: movie.loveCount,
      hasDiscussionThread: movie.hasDiscussionThread,
      imageSrc: movie.movieImageUrl ?? null,
      imageAlt: `${ movie.movieTitle } movie image`,
      movieSiteUrl: movie.movieSiteUrl ?? null,
      movieSiteBackground: movie.movieSiteBackground ?? "#000000",
    }));

  const topRatedMovies = [...filteredFinderMovies]
    .filter((movie) => (movie.thumbsUpCount + movie.loveCount) > 0)
    .sort((leftMovie, rightMovie) => {
      const leftScore = leftMovie.thumbsUpCount + leftMovie.loveCount;
      const rightScore = rightMovie.thumbsUpCount + rightMovie.loveCount;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return +new Date(rightMovie.updatedAt) - +new Date(leftMovie.updatedAt);
    })
    .slice(0, 8)
    .map((movie) => ({
      kind: "top-rated" as const,
      id: movie.id,
      name: movie.movieTitle,
      date: formatStripDate(movie.updatedAt),
      submitterName: movie.submitterName,
      submitterImageUrl: movie.submitterImageUrl ?? null,
      submitterLikenessDegree: movie.memberId === member.memberId ? null : movie.submitterLikenessDegree,
      noRating: movie.noRatingCount,
      thumbsUp: movie.thumbsUpCount,
      love: movie.loveCount,
      commentsCount: movie.commentCount,
      hasDiscussionThread: movie.hasDiscussionThread,
      imageSrc: movie.movieImageUrl ?? null,
      imageAlt: `${ movie.movieTitle } movie image`,
      movieSiteUrl: movie.movieSiteUrl ?? null,
      movieSiteBackground: movie.movieSiteBackground ?? "#000000",
    }));

  const allMovies = [...filteredFinderMovies]
    .sort((leftMovie, rightMovie) => leftMovie.movieTitle.localeCompare(rightMovie.movieTitle, undefined, { sensitivity: "base" }))
    .map((movie) => ({
      kind: "all" as const,
      id: movie.id,
      name: movie.movieTitle,
      date: formatStripDate(movie.updatedAt),
      submitterName: movie.submitterName,
      submitterImageUrl: movie.submitterImageUrl ?? null,
      submitterLikenessDegree: movie.memberId === member.memberId ? null : movie.submitterLikenessDegree,
      noRating: movie.noRatingCount,
      commentsCount: movie.commentCount,
      thumbsUp: movie.thumbsUpCount,
      love: movie.loveCount,
      hasDiscussionThread: movie.hasDiscussionThread,
      imageSrc: movie.movieImageUrl ?? null,
      imageAlt: `${ movie.movieTitle } movie image`,
      movieSiteUrl: movie.movieSiteUrl ?? null,
      movieSiteBackground: movie.movieSiteBackground ?? "#000000",
    }));

  const stripItems = movieStripMode === "all"
    ? allMovies
    : movieStripMode === "latest"
      ? latestMovies
      : topRatedMovies;
  const stripTitle = movieStripMode === "all" ? "All Movies" : movieStripMode === "latest" ? "Latest Movies" : "Top Rated Movies";
  const stripDescription = movieStripMode === "all"
    ? isDateRangeScope
      ? "All movies in the selected date range, ordered by the most recently updated."
      : "All movies, ordered by the most recently updated."
    : movieStripMode === "latest"
      ? isDateRangeScope
        ? "Newest movies in the selected date range."
        : "Newest movies overall."
      : isDateRangeScope
        ? "Top rated movies in the selected date range."
        : "Top rated movies based on total likes and loves.";
  const stripAccentClassName = movieStripMode === "all"
    ? "bg-[linear-gradient(135deg,#ffe0b5,#ffd0bf)]"
    : movieStripMode === "latest"
      ? "bg-[linear-gradient(135deg,#ffb366,#ff8866)]"
      : "bg-[linear-gradient(135deg,#ffa84d,#ff9933)]";

  useEffect(() => {
    if (!selectedMovie) {
      return;
    }

    let isCancelled = false;

    startEngageTransition(async () => {
      const result = await getMovieDetailAction({ movieId: selectedMovie });
      if (isCancelled) {
        return;
      }
      if (!result.success) {
        setSelectedMovieDetail(null);
        return;
      }
      setSelectedMovieDetail(result.movie);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedMovie]);

  const selectedMovieBasic = (selectedMovieDetail?.id === selectedMovie ? selectedMovieDetail : movies.find((movie) => movie.id === selectedMovie)) ?? visibleMovies[0] ?? null;
  const canReactToSelectedMovie = Boolean(selectedMovieBasic && selectedMovieBasic.memberId !== member.memberId);
  const canCommentOnSelectedMovie = canReactToSelectedMovie;
  const canEditSelectedMovie = Boolean(selectedMovieBasic && (selectedMovieBasic.memberId === member.memberId || member.isFounder));

  function handleSelectMovie(movieId: number) {
    setSelectedMovie(movieId);
  }

  function handleOpenMovieFromCard(movieId: number) {
    handleSelectMovie(movieId);
    setIsViewMovieOpen(true);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function handleToggleLike(likenessDegree: number) {
    if (!selectedMovieBasic) {
      return;
    }

    if (selectedMovieBasic.memberId === member.memberId) {
      toast.error("You cannot react to your own movie posting.");
      return;
    }

    startEngageTransition(async () => {
      const result = await toggleMovieLikeAction({ movieId: selectedMovieBasic.id, likenessDegree });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setSelectedMovieDetail(result.movie);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedMovieBasic) {
      return;
    }

    if (!canCommentOnSelectedMovie) {
      toast.error("You cannot comment on your own movie posting.");
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);

    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const payload = {
        movieId: selectedMovieBasic.id,
        commentText: normalizedComment,
        clientRequestId: createClientRequestId("movie-comment"),
      };
      const result = await addMovieCommentAction(payload);
      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFeatureComment({
            kind: "movie",
            payload,
            itemTitle: selectedMovieBasic.movieTitle,
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
      setSelectedMovieDetail(result.movie);
      setCommentText("");
      toast.success(result.message);
    });
  }

  return (
    <FilterSidebarProvider palette={ movieFilterPalette }>
      <FilterSidebar title="Movie Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by movie, genre, adjective, channel, or family member"
          ariaLabel="Search movies"
        />
        <FilterSidebarDateScope
          radioName="movie-date-scope"
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
        <FilterSidebarGroup label="Movie Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="movie-strip-mode" value="all" checked={ movieStripMode === "all" } onChange={ () => setMovieStripMode("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="movie-strip-mode" value="latest" checked={ movieStripMode === "latest" } onChange={ () => setMovieStripMode("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="movie-strip-mode" value="top-rated" checked={ movieStripMode === "top-rated" } onChange={ () => setMovieStripMode("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithDiscussionThreads } onChange={ setFilterWithDiscussionThreads }>Discussions</FilterSidebarCheckbox>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app min-w-0 flex-1 px-4 pb-8 pt-2 sm:px-6 sm:pt-4 lg:px-8">
        <div id="movie-show-welcome" className="mx-auto max-w-7xl space-y-3 sm:space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(96,32,0,0.95),rgba(140,56,12,0.86)_56%,rgba(184,88,24,0.78))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(60,20,0,0.95)] sm:px-8 sm:py-8 lg:px-10">
          <div className="flex flex-col gap-3 sm:gap-5">
            <div className="max-w-3xl">
              <p className="text-[1rem] font-bold uppercase tracking-[0.34em] text-[#ffd9b5]">Family Movie Theater</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <div id="movie-return-home">
                  <Link href="/" className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ffe8d1] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]">
                    <HouseHeart className="font-app mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                    Go Home
                  </Link>
                </div>
                <Link href="/movies/templates" className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#ffe8d1] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"><Edit3 className="mr-1 size-3 sm:size-3.5" />Templates</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">

          <div className="min-w-0 space-y-6 md:order-1">
            <div className="overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/82 shadow-[0_24px_70px_-40px_rgba(96,32,0,0.75)] backdrop-blur">
              <div className="border-b border-[#f0d9c4] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(255,248,240,0.85))] px-4 py-3.5 sm:px-6 sm:py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Movie Directory</p>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-[#8b5a3c]">
                      <h2 className="mt-2 text-2xl font-black tracking-tight text-[#5c2e1a]">Movie Finder</h2>
                      <div id="movie-feature-help">
                        <FeatureFaqHelp
                          href="/feature-faq?category=Movie%20Reviews"
                          buttonClassName="h-4 w-4 md:h-7 md:w-7 border-[#e8c4a0] bg-gradient-to-b from-[#fffaf4] to-[#fde7d5] text-[#b8581a] shadow-[0_8px_18px_rgba(184,88,26,0.2)] group-hover:shadow-[0_12px_26px_rgba(184,88,26,0.28)]"
                          iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#b8581a]"
                          tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]"
                        />
                      </div>
                      <div id="movie-action-buttons">
                        <EditPostIcon tooltip="Filter Movies" tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]">
                          <FilterSidebarTrigger ariaLabel="Toggle movie filters" />
                        </EditPostIcon>
                        <EditPostIcon tooltip="View Movie" tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]">
                          <Button type="button" onClick={ () => setIsViewMovieOpen(true) } disabled={ !selectedMovieBasic } className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#e8c4a0] bg-[#fff6ef] px-2 text-xs font-semibold text-[#7b3306] hover:bg-[#ffefdf] disabled:opacity-50 sm:px-3" aria-label="View selected movie"><Eye className="size-3.5" /><span className="hidden sm:inline">View</span></Button>
                        </EditPostIcon>
                        <EditPostIcon tooltip="Add Movie" tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]">
                          <Button type="button" variant="outline" asChild className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#e8c4a0] bg-[#fff6ef] px-2 text-xs font-semibold text-[#7b3306] hover:bg-[#ffefdf] hover:text-[#7b3306] sm:px-3"><Link href="/movies/add-movie" aria-label="Add movie"><Plus className="size-3.5" /><span className="hidden sm:inline">Add</span></Link></Button>
                        </EditPostIcon>
                        <EditPostIcon tooltip="Edit Movie" tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]">
                          <Button type="button" variant="outline" onClick={ () => router.push(`/movies/add-movie?id=${ selectedMovie }`) } disabled={ !canEditSelectedMovie } className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#e8c4a0] bg-[#fff6ef] px-2 text-xs font-semibold text-[#7b3306] hover:bg-[#ffefdf] hover:text-[#7b3306] disabled:opacity-50 sm:px-3" aria-label="Edit selected movie"><Edit3 className="size-3.5" /><span className="hidden sm:inline">Edit</span></Button>
                        </EditPostIcon>
                      </div>

                    </span>
                    {/* <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8b5a3c]">Search by movie title, tags, channel, or family member and pick what to watch next.</p> */ }
                  </div>
                  {/* <div className="rounded-full border border-[#f0d9c4] bg-[#fdf6ef] px-4 py-2 text-sm font-semibold text-[#8b5a3c]">{ filteredMovies.length } movies found</div> */ }
                </div>

                <div className="mt-1">
                  <MovieScrollStrip
                    title={ stripTitle }
                    description={ stripDescription }
                    items={ stripItems }
                    accentClassName={ stripAccentClassName }
                    selectedItemId={ selectedMovie }
                    onSelectItem={ handleSelectMovie }
                    onOpenItem={ handleOpenMovieFromCard }
                  />
                </div>
              </div>

            </div>

            <div className="overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/90 shadow-[0_24px_70px_-40px_rgba(96,32,0,0.75)]"><div className="border-b border-[#f0d9c4] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,248,240,0.86))] px-5 py-5 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Movie Reactions</p><p className="mt-2 max-w-2xl text-xs leading-6 text-[#8b5a3c]">React to this movie and post comments your family can see.</p></div></div></div><div className="space-y-5 px-5 py-5 sm:px-6">{ selectedMovieBasic ? <><div className="space-y-3 rounded-[1.4rem] border border-[#f0d9c4] bg-[#fff8f2] p-4"><div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={ () => handleToggleLike(-1) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#6d5c52] text-white hover:bg-[#554940]" aria-label="Add thumbs down"><ThumbsDown className={ `size-4 ${ selectedMovieDetail?.likenessDegree === -1 ? "fill-white" : "" }` } /></Button><Button type="button" onClick={ () => handleToggleLike(1) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#b8581a] text-white hover:bg-[#964815]" aria-label="Add thumbs up"><ThumbsUp className={ `size-4 ${ selectedMovieDetail?.likenessDegree === 1 ? "fill-white" : "" }` } /></Button><Button type="button" onClick={ () => handleToggleLike(2) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#cf3f7f] text-white hover:bg-[#aa3368]" aria-label="Add love"><Heart className={ `size-4 ${ selectedMovieDetail?.likenessDegree === 2 ? "fill-white" : "" }` } /></Button></div>{ !canReactToSelectedMovie ? <p className="text-xs text-[#8b5a3c]">You cannot react to your own movie. Ask another family member to rate it.</p> : null }<div className="flex flex-wrap items-center gap-4"><span className="inline-flex items-center gap-1.5 font-semibold text-[#6d5c52]"><ThumbsDown className="size-4 text-[#6d5c52]" />{ (selectedMovieDetail?.noRatingCount ?? selectedMovieBasic?.noRatingCount ?? 0).toLocaleString() }</span><span className="inline-flex items-center gap-1.5 font-semibold text-[#8a5a22]"><ThumbsUp className="size-4 text-[#b8581a]" />{ (selectedMovieDetail?.thumbsUpCount ?? selectedMovieBasic?.thumbsUpCount ?? 0).toLocaleString() }</span><span className="inline-flex items-center gap-1.5 font-semibold text-[#8f2f58]"><Heart className="size-4 fill-[#cf3f7f] text-[#cf3f7f]" />{ (selectedMovieDetail?.loveCount ?? selectedMovieBasic?.loveCount ?? 0).toLocaleString() }</span></div></div>

              { selectedMovieDetail?.id === selectedMovie && (
                <div className="hidden space-y-3 rounded-[1.4rem] border border-[#f0d9c4] bg-[#fff8f2] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#5f7987]">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Discussion Threads</p>
                      <FeatureFaqHelp
                        href="/feature-faq?category=Discussion%20Groups"
                        buttonClassName="h-4 w-4 md:h-7 md:w-7 rounded-xl border-[#c9e2ec] bg-gradient-to-b from-[#f7fcff] to-[#dff2f9] text-[#2a819d] shadow-[0_8px_18px_rgba(42,129,157,0.2)] group-hover:shadow-[0_12px_26px_rgba(42,129,157,0.3)]"
                        iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#b8581a]"
                        tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]"
                      />
                    </div>
                    <div>
                      {/* <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Discussion Threads</p> */ }
                      <p className="text-sm text-[#8b5a3c]">Follow the conversation about this movie with your family.</p>
                    </div>
                    <StartDiscussionDialog
                      targetType="movie"
                      targetId={ selectedMovieBasic.id }
                      topicLabel={ `${ selectedMovieBasic.movieTitle } Discussion` }
                      revalidatePaths={ ["/movies"] }
                      onSuccessRoute="/movies/discussions/:threadId"
                      disabled={ isEngaging }
                      triggerLabel="Add Discussion"
                      triggerClassName="rounded-full bg-[#b8581a] px-4 text-xs font-semibold text-white hover:bg-[#964815]"
                    />
                  </div>
                  { selectedMovieDetail.discussionThreads && selectedMovieDetail.discussionThreads.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[#f0d9c4] bg-white px-3 py-3 text-sm text-[#8b5a3c]">
                      <p>No discussion threads yet. Be the first to start one!</p>
                    </div>
                  ) : selectedMovieDetail.discussionThreads && selectedMovieDetail.discussionThreads.length > 0 ? (
                    <div className="space-y-2">
                      { selectedMovieDetail.discussionThreads.map((discussionThread) => (
                        <article key={ discussionThread.id } className="rounded-xl border border-[#f0d9c4] bg-white px-3 py-2.5 text-sm text-[#734f3a] shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <p className="font-bold leading-snug text-[#5c2e1a]">{ discussionThread.discussTopic }</p>
                              <p className="text-sm text-[#8b5a3c]">{ discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }</p>
                              { (discussionThread.dislikeCount ?? 0) > 0 || (discussionThread.likeCount ?? 0) > 0 || (discussionThread.loveCount ?? 0) > 0 ? (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  { (discussionThread.dislikeCount ?? 0) > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#6d5c52]">
                                      <ThumbsDown className="size-3 text-[#6d5c52]" />
                                      { discussionThread.dislikeCount }
                                    </span>
                                  ) : null }
                                  { (discussionThread.likeCount ?? 0) > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#8a5a22]">
                                      <ThumbsUp className="size-3 text-[#b8581a]" />
                                      { discussionThread.likeCount }
                                    </span>
                                  ) : null }
                                  { (discussionThread.loveCount ?? 0) > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#8f2f58]">
                                      <Heart className="size-3 fill-[#cf3f7f] text-[#cf3f7f]" />
                                      { discussionThread.loveCount }
                                    </span>
                                  ) : null }
                                </div>
                              ) : null }
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              asChild
                              className="shrink-0 rounded-full border-[#e8c4a0] bg-white px-2 py-1 text-sm font-semibold text-[#7b3306] hover:bg-[#fffbf7] hover:text-[#7b3306]"
                            >
                              <Link href={ `/movies/discussions/${ discussionThread.id }` }>
                                View
                              </Link>
                            </Button>
                          </div>
                        </article>
                      )) }
                    </div>
                  ) : null }
                </div>
              ) }

              <div className="hidden space-y-3 rounded-[1.4rem] border border-[#f0d9c4] bg-[#fff8f2] p-4"><div><p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Family Comments</p><p className="text-xs text-[#8b5a3c]">Share your thoughts about this movie with your family.</p></div><div className="space-y-2"><label className="text-sm font-semibold text-[#5c2e1a]" htmlFor="movie-comment-input">Add Comment</label><div id="movie-comment-input"><TipTapCommentEditor value={ commentText } onChange={ setCommentText } placeholder="What did you think about this movie?" disabled={ !selectedMovieBasic || isEngaging } toolbarClassName="border-[#f0d9c4] bg-[#fff1e8]" editorClassName="border-[#f0d9c4] text-[#5c2e1a]" buttonClassName="border-[#e8c4a0] text-[#7b3306]" activeButtonClassName="border-[#b8581a] bg-[#fde7d5] text-[#5c2e1a]" /></div><div className="flex justify-end"><Button type="button" onClick={ handleAddComment } disabled={ !selectedMovieBasic || isEngaging || isSerializedTipTapDocumentEmpty(commentText) } className="rounded-full bg-[#b8581a] text-white hover:bg-[#964815]">Post Comment</Button></div></div><div className="space-y-2">{ selectedMovieDetail?.id === selectedMovie && selectedMovieDetail.movieComments.length === 0 ? <p className="rounded-2xl border border-dashed border-[#f0d9c4] bg-white px-3 py-2 text-sm text-[#8b5a3c]">No comments yet. Be the first family member to add one.</p> : selectedMovieDetail?.id !== selectedMovie ? <p className="rounded-2xl border border-dashed border-[#f0d9c4] bg-white px-3 py-2 text-sm text-[#8b5a3c]">Loading comments...</p> : (selectedMovieDetail?.movieComments ?? []).map((comment) => <article key={ comment.id } className="rounded-2xl border border-[#f0d9c4] bg-white px-3 py-3 text-sm text-[#734f3a]"><TiptapRenderer contentJson={ comment.commentJson } /><p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8b5a3c]">{ comment.commenterName } · { formatCreatedAt(comment.createdAt) }</p></article>) }</div></div></> : <div className="rounded-[1.5rem] border border-dashed border-[#f0d9c4] bg-[#fff8f2] px-6 py-10 text-center text-[#8b5a3c]"><MessageSquareText className="mx-auto mb-3 size-10 text-[#d4a574]" /><p className="text-lg font-semibold text-[#5c2e1a]">Select a movie to view comments.</p><p className="mt-2 text-sm">Choose a movie from the finder list to see and post family comments.</p></div> }</div></div>
          </div>
        </div>
      </div>

      <Dialog open={ isViewMovieOpen } onOpenChange={ setIsViewMovieOpen }>
        <DialogContent className="border-[#f0d9c4] bg-[#fff8f2] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-[#5c2e1a]">{ selectedMovieBasic?.movieTitle ?? "Movie" }</DialogTitle>
            <DialogDescription className="text-[#8b5a3c]">Full movie details and family notes.</DialogDescription>
          </DialogHeader>

          { selectedMovieBasic ? (
            <div className="max-h-[90vh] space-y-4 overflow-auto pr-1">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                <MovieViewer movieJson={ selectedMovieBasic.movieJson } />
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-[#f0d9c4] bg-white">
                    <div className="relative aspect-16/10 overflow-hidden">
                      { selectedMovieBasic.movieImageUrl ? (
                        <ModalMovieImage
                          src={ selectedMovieBasic.movieImageUrl }
                          alt={ `${ selectedMovieBasic.movieTitle } movie image` }
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[#3b2315] px-4">
                          <span className="text-center text-sm font-semibold text-white/80">No movie image available.</span>
                        </div>
                      ) }
                      <span className="absolute left-3 top-3 inline-flex" title={ selectedMovieBasic.submitterName }>
                        <MemberAvatar
                          imageUrl={ selectedMovieBasic.submitterImageUrl }
                          firstName={ selectedMovieBasic.submitterName }
                          sizeClassName="h-10 w-10"
                          chromeClassName="border-2 border-white shadow-md"
                        />
                      </span>
                    </div>
                  </div>

                  { (!selectedMovieBasic.movieSiteUrl || selectedMovieBasic.movieImageUrl) ?
                    <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#a85a3a]">
                        Image Credit
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#734f3a] wrap-anywhere">{ selectedMovieBasic.movieImageCredit || "No movie image credit provided." }</p>
                    </div> : null }
                  { selectedMovieBasic.movieSiteUrl ? (
                    <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#a85a3a]">Official Site</p>
                      <a
                        href={ selectedMovieBasic.movieSiteUrl }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-[#7b3306] underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-4" />
                        { selectedMovieBasic.movieSiteUrl.includes("imdb.com") ? "View on IMDb" : "View on YouTube" }
                      </a>
                    </div>
                  ) : null }
                  <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4"><p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#a85a3a]">Details</p><div className="mt-2 space-y-1.5 text-sm leading-5 text-[#734f3a]"><p><span className="font-semibold text-[#5c2e1a]">Submitter:</span> { selectedMovieBasic.submitterName }</p><p><span className="font-semibold text-[#5c2e1a]">Updated:</span> { formatDate(selectedMovieBasic.updatedAt) }</p><p><span className="font-semibold text-[#5c2e1a]">Debut Year:</span> { selectedMovieBasic.movieDebutYear }</p><p><span className="font-semibold text-[#5c2e1a]">Channel:</span> { selectedMovieBasic.tagNamesByType.channel?.[0] ?? "Unknown" }</p></div></div>

                  <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#a85a3a]">Tags</p>
                    { getMovieTagNames(selectedMovieBasic).length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-[#734f3a]">
                        { getMovieTagNames(selectedMovieBasic).map((tagName) => (
                          <span key={ tagName } className="rounded-full bg-[#fde7d5] px-2.5 py-1 text-xs font-semibold text-[#7b3306]">
                            { tagName }
                          </span>
                        )) }
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#8b5a3c]">No tags added.</p>
                    ) }
                  </div>
                  <div className="rounded-2xl border border-[#f0d9c4] bg-white p-4"><p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#a85a3a]">Reactions</p><div className="mt-3 flex flex-wrap items-center gap-3"><Button type="button" onClick={ () => handleToggleLike(-1) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#6d5c52] text-white hover:bg-[#554940]" aria-label="Add thumbs down"><ThumbsDown className={ `size-4 ${ selectedMovieDetail?.likenessDegree === -1 ? "fill-white" : "" }` } /></Button><Button type="button" onClick={ () => handleToggleLike(1) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#b8581a] text-white hover:bg-[#964815]" aria-label="Add thumbs up"><ThumbsUp className={ `size-4 ${ selectedMovieDetail?.likenessDegree === 1 ? "fill-white" : "" }` } /></Button><Button type="button" onClick={ () => handleToggleLike(2) } disabled={ !selectedMovieBasic || isEngaging || !canReactToSelectedMovie } className="rounded-full bg-[#cf3f7f] text-white hover:bg-[#aa3368]" aria-label="Add love"><Heart className={ `size-4 ${ selectedMovieDetail?.likenessDegree === 2 ? "fill-white" : "" }` } /></Button>{ !canReactToSelectedMovie ? <p className="text-xs text-[#8b5a3c]">You cannot react to your own movie. Ask another family member to rate it.</p> : null }</div><div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold text-[#734f3a]"><ReactionMemberHoverCard icon={ <ThumbsDown className="size-4 text-[#6d5c52]" /> } count={ selectedMovieDetail?.noRatingCount ?? selectedMovieBasic.noRatingCount ?? 0 } memberNames={ selectedMovieDetail?.noRatingMemberNames ?? [] } triggerClassName="bg-[#f7f0eb]" emptyLabel="Family members who disliked this movie" /><ReactionMemberHoverCard icon={ <ThumbsUp className="size-4 text-[#b8581a]" /> } count={ selectedMovieDetail?.thumbsUpCount ?? selectedMovieBasic.thumbsUpCount ?? 0 } memberNames={ selectedMovieDetail?.thumbsUpMemberNames ?? [] } triggerClassName="bg-[#fff1e8]" textClassName="text-[#8a5a22]" emptyLabel="Family members who liked this movie" /><ReactionMemberHoverCard icon={ <Heart className="size-4 fill-[#cf3f7f] text-[#cf3f7f]" /> } count={ selectedMovieDetail?.loveCount ?? selectedMovieBasic.loveCount ?? 0 } memberNames={ selectedMovieDetail?.loveMemberNames ?? [] } triggerClassName="bg-[#fff0f7]" textClassName="text-[#8f2f58]" emptyLabel="Family members who loved this movie" /><span className="inline-flex items-center gap-2 rounded-full bg-[#fff1e8] px-3 py-0.5"><MessageSquareText className="size-4 text-[#b8581a]" /><span className="pointer-events-none select-none">{ selectedMovieDetail?.commentCount ?? selectedMovieBasic.commentCount ?? 0 }</span></span></div></div>
                </div>
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#f0d9c4] bg-[#fff8f2] p-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Family Comments</p>
                  <p className="text-xs text-[#8b5a3c]">Share your thoughts about this movie with your family.</p>
                </div>

                <div className="space-y-2">
                  { selectedMovieDetail?.id === selectedMovie && selectedMovieDetail.movieComments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#f0d9c4] bg-white px-3 py-2 text-sm text-[#8b5a3c]">No comments yet. Be the first family member to add one.</p>
                  ) : selectedMovieDetail?.id !== selectedMovie ? (
                    <p className="rounded-2xl border border-dashed border-[#f0d9c4] bg-white px-3 py-2 text-sm text-[#8b5a3c]">Loading comments...</p>
                  ) : (
                    (selectedMovieDetail?.movieComments ?? []).map((comment) => (
                      <article key={ comment.id } className="rounded-2xl border border-[#f0d9c4] bg-white px-3 py-3 text-sm text-[#734f3a]">
                        <TiptapRenderer contentJson={ comment.commentJson } />
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8b5a3c]">{ comment.commenterName } · { formatCreatedAt(comment.createdAt) }</p>
                      </article>
                    ))
                  ) }
                </div>

                { canCommentOnSelectedMovie ? (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#5c2e1a]" htmlFor="movie-comment-input-dialog">Add Comment</label>
                    <div id="movie-comment-input-dialog">
                      <TipTapCommentEditor
                        value={ commentText }
                        onChange={ setCommentText }
                        placeholder="What did you think about this movie?"
                        disabled={ !selectedMovieBasic || isEngaging }
                        toolbarClassName="border-[#f0d9c4] bg-[#fff1e8]"
                        editorClassName="border-[#f0d9c4] text-[#5c2e1a]"
                        buttonClassName="border-[#e8c4a0] text-[#7b3306]"
                        activeButtonClassName="border-[#b8581a] bg-[#fde7d5] text-[#5c2e1a]"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={ handleAddComment }
                        disabled={ !selectedMovieBasic || isEngaging || isSerializedTipTapDocumentEmpty(commentText) }
                        className="rounded-full bg-[#b8581a] text-white hover:bg-[#964815]"
                      >
                        Post Comment
                      </Button>
                    </div>
                  </div>
                ) : null }
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#f0d9c4] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#8b5a3c]">
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#a85a3a]">Discussion Threads</p>
                      <FeatureFaqHelp
                        href="/feature-faq?category=Discussion%20Groups"
                        buttonClassName="h-4 w-4 md:h-7 md:w-7 rounded-xl border-[#e8c4a0] bg-gradient-to-b from-[#fffaf4] to-[#fde7d5] text-[#b8581a] shadow-[0_8px_18px_rgba(184,88,26,0.2)] group-hover:shadow-[0_12px_26px_rgba(184,88,26,0.28)]"
                        iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#b8581a]"
                        tooltipClassName="bg-[#5c2e1a] text-[#fff6ef]"
                      />
                    </div>
                    <p className="text-xs text-[#8b5a3c]">Follow the conversation that belongs to this movie.</p>
                  </div>
                  <StartDiscussionDialog
                    targetType="movie"
                    targetId={ selectedMovieBasic.id }
                    topicLabel={ `${ selectedMovieBasic.movieTitle } Discussion ${ (selectedMovieDetail?.id === selectedMovie
                      ? selectedMovieDetail.discussionThreads.length
                      : 0) + 1 }` }
                    revalidatePaths={ ["/movies"] }
                    onSuccessRoute="/movies/discussions/:threadId"
                    disabled={ isEngaging || selectedMovieDetail?.id !== selectedMovie }
                    triggerLabel="Add Discussion"
                    triggerClassName="rounded-full bg-[#b8581a] px-4 text-xs font-semibold text-white hover:bg-[#964815]"
                  />
                </div>

                { selectedMovieDetail?.id !== selectedMovie ? (
                  <p className="rounded-2xl border border-dashed border-[#f0d9c4] bg-[#fff8f2] px-3 py-2 text-sm text-[#8b5a3c]">
                    Loading discussion threads...
                  </p>
                ) : selectedMovieDetail.discussionThreads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#f0d9c4] bg-[#fff8f2] px-3 py-3 text-sm text-[#8b5a3c]">
                    <p>No discussion threads have been added for this movie yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    { selectedMovieDetail.discussionThreads.map((discussionThread) => (
                      <article key={ discussionThread.id } className="rounded-2xl border border-[#f0d9c4] bg-[#fff8f2] px-4 py-4 text-sm text-[#734f3a] shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1 flex-1">
                            <p className="text-base font-bold leading-snug text-[#5c2e1a]">{ discussionThread.discussTopic }</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[#8b5a3c]">
                              { discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 shrink-0">
                            { discussionThread.dislikeCount > 0 || discussionThread.likeCount > 0 || discussionThread.loveCount > 0 ? (
                              <div className="flex flex-wrap items-center gap-2">
                                { discussionThread.dislikeCount > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#efe8e3] px-2 py-1 text-[0.65rem] font-semibold text-[#4f433d]">
                                    <ThumbsDown className="size-3" />
                                    { discussionThread.dislikeCount }
                                  </span>
                                ) }
                                { discussionThread.likeCount > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e8] px-2 py-1 text-[0.65rem] font-semibold text-[#8a5a22]">
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
                              className="shrink-0 rounded-full border-[#e8c4a0] bg-white px-3 py-1 text-xs font-semibold text-[#7b3306] hover:bg-[#fffbf7] hover:text-[#7b3306]"
                            >
                              <Link href={ `/movies/discussions/${ discussionThread.id }` }>
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
      <GuidedTourLauncher initialPayload={ initialGuidedLaunchPayload } tourKey="movie_tour" />
    </FilterSidebarProvider>
  );
}

function ModalMovieImage({ src, alt }: { src: string; alt: string }) {
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
