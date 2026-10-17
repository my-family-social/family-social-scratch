"use client";

import type { JSONContent } from "@tiptap/core";
import LinkExtension from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/react";
import { Edit3, Eye, Heart, HouseHeart, MessageSquareText, Plus, Printer, ThumbsUp, ThumbsDown } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import {
  toggleRecipeLikeAction,
  addRecipeCommentAction,
  getFoodiesRecipeDetailAction,
} from "@/app/(features)/(foodies)/foodies/actions";
import TipTapCommentEditor from "@/components/common/tiptap-comment-editor";
import MemberAvatar from "@/components/common/member-avatar";
import TiptapRenderer from "@/components/discuss/tiptap-renderer";
import { FoodiesRecipe, FoodiesRecipeDetail } from "@/components/db/types/recipes";
import {
  createEmptyTipTapDocument,
  isSerializedTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
} from "@/components/db/types/poem-term-validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import {
  clearQueuedFoodiesRecipeComment,
  createClientRequestId,
  getPwaSyncNowEventName,
  isBrowserOnline,
  queueFoodiesRecipeComment,
  readQueuedFoodiesRecipeComments,
} from "@/lib/pwa-background-sync";
import { FoodiesScrollStrip } from "@/features/foodies/components/foodies-scroll-strip";
import { MemberKeyDetails } from "@/features/family/types/family-steps";
import FeatureFaqHelp from "@/components/common/feature-faq-help";
import EditPostIcon from "@/components/common/edit-post-icon";
import StartDiscussionDialog from "@/components/discuss/start-discussion-dialog";
import { getActiveFoodiesRecipeDetail } from "@/features/foodies/lib/active-recipe-detail";
import { getRecipeReactionMemberNames } from "@/features/foodies/lib/reaction-member-names";
import { canCommentOnRecipe } from "@/features/foodies/lib/recipe-comment-permissions";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

const foodiesFilterPalette: FilterSidebarPalette = {
  sidebarBackground: "#f7fce8",
  sidebarForeground: "#2f4820",
  sidebarBorder: "#dbeacc",
  label: "#5f7a40",
  muted: "#647a50",
  inputBorder: "#ccdfb9",
  inputText: "#2f4820",
  chipBorder: "#cadfbb",
  chipText: "#2f4820",
  chipHoverBackground: "#f7fce8",
  checkBorder: "#9fc487",
  checkboxText: "#4f6f36",
  accent: "#578c24",
  accentHoverBackground: "#4a7320",
  triggerBorder: "#cfe8b2",
  triggerBackground: "#f7fce8",
  triggerText: "#2f4820",
  triggerHoverBackground: "#e5f7cb",
};

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
        <span className={ `inline-flex cursor-default items-center gap-2 rounded-full px-3 py-1 ${ triggerClassName } ${ textClassName ?? "" }` }>
          { icon }
          { count.toLocaleString() }
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="font-app w-56 border-[#cadfbb] bg-white text-xs text-[#4e6640]">
        <p className="font-semibold text-[#2f4820]">{ emptyLabel }</p>
        { memberNames.length > 0 ? (
          <ul className="mt-2 space-y-1">
            { memberNames.map((memberName) => (
              <li key={ memberName }>{ memberName }</li>
            )) }
          </ul>
        ) : (
          <p className="mt-2 text-[#647a50]">No family members yet.</p>
        ) }
      </HoverCardContent>
    </HoverCard>
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getRecipeCategoryNames(recipe: FoodiesRecipe) {
  return [
    ...(recipe.tagNamesByType.cuisine ?? []),
    ...(recipe.tagNamesByType.course_type ?? []),
    ...(recipe.tagNamesByType.cooking_method ?? []),
    ...(recipe.tagNamesByType.dietary ?? []),
    ...(recipe.tagNamesByType.meal_time ?? []),
  ].filter((categoryName, index, categoryNames) => categoryNames.indexOf(categoryName) === index);
}

function getRecipeDocument(recipeJson?: string): JSONContent {
  if (!recipeJson) {
    return createEmptyTipTapDocument();
  }

  const parsed = parseSerializedTipTapDocument(recipeJson);
  return parsed.success ? parsed.content : createEmptyTipTapDocument();
}

function getRecipeProTipDocument(proTipJson?: string): JSONContent {
  if (!proTipJson) {
    return createEmptyTipTapDocument();
  }

  const parsed = parseSerializedTipTapDocument(proTipJson);
  return parsed.success ? parsed.content : createEmptyTipTapDocument();
}

function RecipeViewer({ recipeJson }: { recipeJson?: string }) {
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
    content: getRecipeDocument(recipeJson),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap min-h-112 text-[#2f4820] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!viewer) {
      return;
    }

    viewer.commands.setContent(getRecipeDocument(recipeJson));
  }, [viewer, recipeJson]);

  return (
    <div className="rounded-2xl border border-[#cadfbb] bg-white p-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-1 [&_.tiptap_hr]:my-4 [&_.tiptap_hr]:border-[#cadfbb] [&_.tiptap_table]:w-full [&_.tiptap_table]:border-collapse [&_.tiptap_table]:border [&_.tiptap_table]:border-[#cadfbb] [&_.tiptap_th]:border [&_.tiptap_th]:border-[#cadfbb] [&_.tiptap_th]:bg-[#f4fae7] [&_.tiptap_th]:px-2 [&_.tiptap_th]:py-1 [&_.tiptap_td]:border [&_.tiptap_td]:border-[#cadfbb] [&_.tiptap_td]:px-2 [&_.tiptap_td]:py-1">
      <EditorContent editor={ viewer } />
    </div>
  );
}

function RecipeProTipViewer({ proTipJson }: { proTipJson: string }) {
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
    ],
    content: getRecipeProTipDocument(proTipJson),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap text-[#2f4820] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!viewer) {
      return;
    }

    viewer.commands.setContent(getRecipeProTipDocument(proTipJson));
  }, [viewer, proTipJson]);

  return (
    <div className="rounded-2xl border border-[#dbeacc] bg-white p-4 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_li]:my-1 [&_.tiptap_h2]:mb-2 [&_.tiptap_h2]:text-lg [&_.tiptap_h2]:font-bold [&_.tiptap_h3]:mb-2 [&_.tiptap_h3]:font-semibold">
      <EditorContent editor={ viewer } />
    </div>
  );
}

export function FoodiesHomePage({
  recipes,
  member,
  isAdmin: _isAdmin,
}: {
  recipes: FoodiesRecipe[];
  member: MemberKeyDetails;
  isAdmin: boolean;
}) {
  void _isAdmin;

  const [isEngaging, startEngageTransition] = useTransition();
  const [selectedRecipeDetail, setSelectedRecipeDetail] = useState<FoodiesRecipeDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isViewRecipeOpen, setIsViewRecipeOpen] = useState(false);
  const [recipeStripMode, setRecipeStripMode] = useState<"all" | "latest" | "top-rated">("all");
  const [dateScope, setDateScope] = useState<"everything" | "date-range">("everything");
  const recipePrintContentRef = useRef<HTMLDivElement | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const canAccessDraftRecipe = (recipeMemberId: number) => recipeMemberId === member.memberId || member.isFounder;

  const visibleRecipes = recipes.filter((recipe) => (
    recipe.status === "published"
    || (recipe.status === "draft" && canAccessDraftRecipe(recipe.memberId))
    || (includeArchived && recipe.status === "archived")
  ));

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

  const isDateRangeScope = dateScope === "date-range";
  const hasPendingDateChanges = startDate !== appliedStartDate || endDate !== appliedEndDate;
  const startDateValue = isDateRangeScope && appliedStartDate ? new Date(`${ appliedStartDate }T00:00:00`) : null;
  const endDateValue = isDateRangeScope && appliedEndDate ? new Date(`${ appliedEndDate }T23:59:59.999`) : null;

  const filteredFinderRecipes = visibleRecipes.filter((recipe) => {
    const updatedAt = new Date(recipe.updatedAt);

    if (startDateValue && updatedAt < startDateValue) {
      return false;
    }

    if (endDateValue && updatedAt > endDateValue) {
      return false;
    }

    if (filterWithDiscussionThreads && !recipe.hasDiscussionThread) {
      return false;
    }

    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      recipe.recipeTitle,
      recipe.submitterName,
      ...getRecipeCategoryNames(recipe),
      String(recipe.prepTimeMins),
      String(recipe.cookTimeMins),
    ].join(" ").toLowerCase().includes(query);
  });

  const latestRecipeRecords = [...filteredFinderRecipes]
    .filter((recipe) => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      return new Date(recipe.updatedAt).getTime() >= twoMonthsAgo.getTime();
    })
    .sort((leftRecipe, rightRecipe) => +new Date(rightRecipe.updatedAt) - +new Date(leftRecipe.updatedAt))
    .slice(0, 8);

  const latestRecipes = latestRecipeRecords
    .map((recipe) => ({
      kind: "latest" as const,
      id: recipe.id,
      name: recipe.recipeTitle,
      date: formatStripDate(recipe.updatedAt),
      status: recipe.status,
      submitterName: recipe.submitterName,
      submitterImageUrl: recipe.submitterImageUrl ?? null,
      submitterLikenessDegree: recipe.memberId === member.memberId ? null : recipe.submitterLikenessDegree,
      commentsCount: recipe.commentCount,
      thumbsUp: recipe.thumbsUpCount,
      love: recipe.loveCount,
      hasDiscussionThread: recipe.hasDiscussionThread,
      imageSrc: recipe.recipeImageUrl ?? "/images/foodies/banana-bread-tablet.png",
      imageAlt: `${ recipe.recipeTitle } recipe photo`,
    }));

  const topRatedRecipes = [...filteredFinderRecipes]
    .filter((recipe) => (recipe.thumbsUpCount + recipe.loveCount) > 0)
    .sort((leftRecipe, rightRecipe) => {
      const leftScore = leftRecipe.thumbsUpCount + leftRecipe.loveCount;
      const rightScore = rightRecipe.thumbsUpCount + rightRecipe.loveCount;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return +new Date(rightRecipe.updatedAt) - +new Date(leftRecipe.updatedAt);
    })
    .slice(0, 8)
    .map((recipe) => ({
      kind: "top-rated" as const,
      id: recipe.id,
      name: recipe.recipeTitle,
      date: formatStripDate(recipe.updatedAt),
      status: recipe.status,
      submitterName: recipe.submitterName,
      submitterImageUrl: recipe.submitterImageUrl ?? null,
      submitterLikenessDegree: recipe.memberId === member.memberId ? null : recipe.submitterLikenessDegree,
      noRating: recipe.noRatingCount,
      thumbsUp: recipe.thumbsUpCount,
      love: recipe.loveCount,
      commentsCount: recipe.commentCount,
      hasDiscussionThread: recipe.hasDiscussionThread,
      imageSrc: recipe.recipeImageUrl ?? "/images/foodies/vegetable-soup-tablet.png",
      imageAlt: `${ recipe.recipeTitle } recipe photo`,
    }));

  const allRecipes = [...filteredFinderRecipes]
    .sort((leftRecipe, rightRecipe) => leftRecipe.recipeTitle.localeCompare(rightRecipe.recipeTitle, undefined, { sensitivity: "base" }))
    .map((recipe) => ({
      kind: "all" as const,
      id: recipe.id,
      name: recipe.recipeTitle,
      date: formatStripDate(recipe.updatedAt),
      status: recipe.status,
      submitterName: recipe.submitterName,
      submitterImageUrl: recipe.submitterImageUrl ?? null,
      submitterLikenessDegree: recipe.memberId === member.memberId ? null : recipe.submitterLikenessDegree,
      commentsCount: recipe.commentCount,
      thumbsUp: recipe.thumbsUpCount,
      love: recipe.loveCount,
      hasDiscussionThread: recipe.hasDiscussionThread,
      imageSrc: recipe.recipeImageUrl ?? "/images/foodies/banana-bread-tablet.png",
      imageAlt: `${ recipe.recipeTitle } recipe photo`,
    }));

  const stripItems = recipeStripMode === "all" ? allRecipes : recipeStripMode === "latest" ? latestRecipes : topRatedRecipes;
  const stripTitle = recipeStripMode === "all" ? "All Recipes" : recipeStripMode === "latest" ? "Latest Recipes" : "Top Rated Recipes";
  const stripDescription = recipeStripMode === "all"
    ? isDateRangeScope
      ? "All recipes in the selected date range, ordered by the most recently updated."
      : "All recipes first, ordered by the most recently updated."
    : recipeStripMode === "latest"
      ? isDateRangeScope
        ? "Newest recipes in the selected date range."
        : "Newest recipes overall."
      : isDateRangeScope
        ? "Top rated recipes in the selected date range."
        : "Top rated recipes based on total likes and loves.";
  const stripAccentClassName = recipeStripMode === "all"
    ? "bg-[linear-gradient(135deg,#d9f0c8,#fff6c9)]"
    : recipeStripMode === "latest"
      ? "bg-[linear-gradient(135deg,#d3f0b3,#fff6c9)]"
      : "bg-[linear-gradient(135deg,#ffd7a8,#ffd0b7)]";

  const [selectedRecipe, setSelectedRecipe] = useState(filteredFinderRecipes[0]?.id ?? 0);

  useEffect(() => {
    const flushQueuedRecipeComments = async () => {
      if (!isBrowserOnline()) {
        return;
      }

      const queuedComments = readQueuedFoodiesRecipeComments();

      for (const queuedComment of queuedComments) {
        const result = await addRecipeCommentAction(queuedComment.payload);

        if (!result.success) {
          continue;
        }

        if (queuedComment.payload.clientRequestId) {
          clearQueuedFoodiesRecipeComment(queuedComment.payload.clientRequestId);
        }

        if (selectedRecipe === queuedComment.payload.recipeId) {
          setSelectedRecipeDetail(result.recipe);
        }
      }
    };

    void flushQueuedRecipeComments();

    const handleOnline = () => {
      void flushQueuedRecipeComments();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener(getPwaSyncNowEventName(), handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(getPwaSyncNowEventName(), handleOnline);
    };
  }, [selectedRecipe]);

  useEffect(() => {
    if (!selectedRecipe) {
      return;
    }

    let isCancelled = false;

    startEngageTransition(async () => {
      const result = await getFoodiesRecipeDetailAction({ recipeId: selectedRecipe });

      if (isCancelled) {
        return;
      }

      if (!result.success) {
        setSelectedRecipeDetail(null);
        return;
      }

      setSelectedRecipeDetail(result.recipe);
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedRecipe]);

  useEffect(() => {
    const hasActiveRecipeDetail = selectedRecipeDetail?.id === selectedRecipe;

    if (!isViewRecipeOpen || !selectedRecipe || hasActiveRecipeDetail) {
      return;
    }

    let isCancelled = false;

    startEngageTransition(async () => {
      const result = await getFoodiesRecipeDetailAction({ recipeId: selectedRecipe });

      if (isCancelled) {
        return;
      }

      if (!result.success) {
        return;
      }

      setSelectedRecipeDetail(result.recipe);
    });

    return () => {
      isCancelled = true;
    };
  }, [isViewRecipeOpen, selectedRecipe, selectedRecipeDetail]);

  const selectedRecipeBasic =
    (selectedRecipeDetail?.id === selectedRecipe
      ? selectedRecipeDetail
      : recipes.find((recipe) => recipe.id === selectedRecipe))
    ?? null;
  const activeRecipeDetail = getActiveFoodiesRecipeDetail(selectedRecipe, selectedRecipeDetail);
  const selectedRecipeOwnerId = recipes.find((recipe) => recipe.id === selectedRecipe)?.memberId ?? null;
  const canEditSelectedRecipe = Boolean(
    selectedRecipeOwnerId !== null
    && (selectedRecipeOwnerId === member.memberId || member.isFounder)
  );
  const canReactToSelectedRecipe = Boolean(selectedRecipeBasic && selectedRecipeBasic.memberId !== member.memberId);
  const canCommentOnSelectedRecipe = canCommentOnRecipe(selectedRecipeBasic, member.memberId);

  function handleSelectRecipe(recipeId: number) {
    setCommentText("");

    if (recipeId === selectedRecipe) {
      return;
    }

    const recipe = recipes.find((r) => r.id === recipeId);
    if (recipe) {
      setSelectedRecipe(recipeId);
      setSelectedRecipeDetail(null);
    }
  }

  function handleOpenRecipeFromCard(recipeId: number) {
    handleSelectRecipe(recipeId);
    setIsViewRecipeOpen(true);
  }

  function handleApplyDateRange() {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setDateScope("date-range");
  }

  function handleToggleLike(likenessDegree: number) {
    if (!selectedRecipeBasic) {
      return;
    }

    if (selectedRecipeBasic.memberId === member.memberId) {
      toast.error("You cannot react to your own recipe posting.");
      return;
    }

    startEngageTransition(async () => {
      const result = await toggleRecipeLikeAction({
        recipeId: selectedRecipeBasic.id,
        likenessDegree,
      });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setSelectedRecipeDetail(result.recipe);
      toast.success(result.message);
    });
  }

  function handleAddComment() {
    if (!selectedRecipeBasic) {
      return;
    }

    if (!canCommentOnSelectedRecipe) {
      toast.error("You cannot comment on your own recipe posting.");
      return;
    }

    const normalizedComment = normalizeSerializedTipTapDocument(commentText);

    if (isSerializedTipTapDocumentEmpty(normalizedComment)) {
      toast.error("Enter a comment before posting.");
      return;
    }

    startEngageTransition(async () => {
      const clientRequestId = createClientRequestId("foodies-comment");
      const payload = {
        recipeId: selectedRecipeBasic.id,
        commentText: normalizedComment,
        clientRequestId,
      };
      const result = await addRecipeCommentAction(payload);

      if (!result.success) {
        if (!isBrowserOnline()) {
          queueFoodiesRecipeComment({
            payload,
            recipeTitle: selectedRecipeBasic.recipeTitle,
            commenterName: `${ member.firstName } ${ member.lastName }`.trim(),
            queuedAt: new Date().toISOString(),
          });

          setSelectedRecipeDetail((currentRecipe) => {
            if (!currentRecipe || currentRecipe.id !== selectedRecipeBasic.id) {
              return currentRecipe;
            }

            return {
              ...currentRecipe,
              commentCount: currentRecipe.commentCount + 1,
              recipeComments: [
                {
                  id: Date.now(),
                  createdAt: new Date(),
                  commenterName: `${ member.firstName } ${ member.lastName }`.trim(),
                  commentJson: normalizedComment,
                },
                ...currentRecipe.recipeComments,
              ],
            };
          });

          setCommentText("");
          toast.message("Comment saved locally. It will sync when you are back online.");
          return;
        }

        toast.error(result.message);
        return;
      }

      setSelectedRecipeDetail(result.recipe);
      setCommentText("");
      toast.success(result.message);
    });
  }

  function handleOpenRecipePrintPreview() {
    if (!selectedRecipeBasic) {
      return;
    }

    // Open the window immediately from the click handler so browsers treat it as a direct user gesture.
    const printWindow = window.open("", "foodies-print-preview", "width=1080,height=900");

    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups for localhost and disable popup-blocking extensions for this site.");
      return;
    }

    try {
      printWindow.opener = null;
    } catch {
      // Ignore cross-browser opener assignment issues.
    }

    const printRoot = recipePrintContentRef.current;
    const tiptapBlocks = Array.from(printRoot?.querySelectorAll(".tiptap") ?? []);
    const recipeBodyHtml = tiptapBlocks[0]?.innerHTML?.trim() ?? "";

    if (!recipeBodyHtml) {
      printWindow.close();
      toast.error("Recipe content is still loading. Try again in a moment.");
      return;
    }

    const proTipBodyBlocks = tiptapBlocks
      .slice(1)
      .map((element) => element.innerHTML.trim())
      .filter((html) => html.length > 0);

    const detailRecipeProTips = activeRecipeDetail?.recipeProTips ?? [];
    const printableProTipsHtml = detailRecipeProTips.length === 0
      ? '<p class="preview-muted">No pro tips were added for this recipe yet.</p>'
      : detailRecipeProTips.map((proTip, index) => {
        const proTipBody = proTipBodyBlocks[index] || '<p class="preview-muted">No TipTap content found.</p>';
        return `<article class="preview-pro-tip">
          <div class="preview-rich-text">${ proTipBody }</div>
          <p class="preview-tip-meta">${ escapeHtml(proTip.commenterName) } - ${ escapeHtml(formatCreatedAt(proTip.createdAt)) }</p>
        </article>`;
      }).join("");

    const title = escapeHtml(selectedRecipeBasic.recipeTitle || "Recipe Print Preview");
    const summary = escapeHtml(selectedRecipeBasic.recipeShortSummary || "No summary provided.");
    const submitter = escapeHtml(selectedRecipeBasic.submitterName || "Unknown");
    const updatedAt = escapeHtml(formatDate(selectedRecipeBasic.updatedAt));
    const prep = selectedRecipeBasic.prepTimeMins > 0 ? `${ selectedRecipeBasic.prepTimeMins } min` : "-";
    const cook = selectedRecipeBasic.cookTimeMins > 0 ? `${ selectedRecipeBasic.cookTimeMins } min` : "-";
    const thumbsUp = (activeRecipeDetail?.thumbsUpCount ?? selectedRecipeBasic.thumbsUpCount ?? 0).toLocaleString();
    const love = (activeRecipeDetail?.loveCount ?? selectedRecipeBasic.loveCount ?? 0).toLocaleString();
    const commentCount = activeRecipeDetail?.commentCount ?? selectedRecipeBasic.commentCount ?? 0;

    printWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${ title }</title>
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 0;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #1f2f14;
        background: #f3f9e8;
      }

      .preview-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: #2f4820;
        color: #f8ffe9;
      }

      .preview-toolbar button {
        border: 1px solid rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
        border-radius: 999px;
        padding: 8px 14px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
      }

      .preview-toolbar button:hover {
        background: rgba(255, 255, 255, 0.26);
      }

      .preview-page {
        max-width: 980px;
        margin: 18px auto;
        padding: 0 14px 18px;
      }

      .preview-card {
        background: #ffffff;
        border: 1px solid #d5e5c7;
        border-radius: 16px;
        padding: 18px;
      }

      .preview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.25fr) minmax(16rem, 0.75fr);
        gap: 16px;
      }

      .preview-pane {
        border: 1px solid #d5e5c7;
        border-radius: 12px;
        padding: 14px;
      }

      .preview-pane + .preview-pane {
        margin-top: 12px;
      }

      .preview-label {
        margin: 0;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #4f6a39;
        font-weight: 700;
      }

      .preview-muted {
        margin-top: 8px;
        color: #5e7a49;
        font-size: 13px;
      }

      .preview-metrics {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .preview-metrics span {
        display: inline-flex;
        align-items: center;
        border: 1px solid #d5e5c7;
        border-radius: 999px;
        padding: 4px 10px;
        background: #f6fbe9;
      }

      .preview-rich-text ul,
      .preview-rich-text ol {
        margin: 0.75rem 0;
        padding-left: 1.35rem;
      }

      .preview-pro-tip + .preview-pro-tip {
        margin-top: 10px;
      }

      .preview-tip-meta {
        margin-top: 8px;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6e8759;
      }

      .preview-card h1,
      .preview-card h2,
      .preview-card h3 {
        color: #1f2f14;
      }

      .preview-card p,
      .preview-card li,
      .preview-card td,
      .preview-card th {
        color: #324d24;
        line-height: 1.6;
      }

      .preview-card ul,
      .preview-card ol {
        margin: 0.75rem 0;
        padding-left: 1.35rem;
      }

      .preview-card table {
        width: 100%;
        border-collapse: collapse;
      }

      .preview-card th,
      .preview-card td {
        border: 1px solid #d5e5c7;
        padding: 6px 8px;
      }

      .preview-card hr {
        border: none;
        border-top: 1px solid #d5e5c7;
        margin: 1rem 0;
      }

      @media print {
        .preview-toolbar {
          display: none;
        }

        .preview-grid {
          grid-template-columns: 1fr;
        }

        body {
          background: #fff;
        }

        .preview-page {
          margin: 0;
          max-width: none;
          padding: 0;
        }

        .preview-card {
          border: none;
          border-radius: 0;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="preview-toolbar">
      <strong>${ title }</strong>
      <button type="button" onclick="window.print()">Print</button>
    </div>
    <main class="preview-page">
      <section class="preview-card">
        <h1>${ title }</h1>
        <div class="preview-grid">
          <div class="preview-pane">
            <p class="preview-label">Recipe</p>
            <div class="preview-rich-text">${ recipeBodyHtml }</div>
          </div>

          <div>
            <section class="preview-pane">
              <p class="preview-label">Summary</p>
              <p>${ summary }</p>
            </section>

            <section class="preview-pane">
              <p class="preview-label">Details</p>
              <p><strong>Submitter:</strong> ${ submitter }</p>
              <p><strong>Updated:</strong> ${ updatedAt }</p>
              <p><strong>Prep:</strong> ${ prep }</p>
              <p><strong>Cook:</strong> ${ cook }</p>
            </section>

            <section class="preview-pane">
              <p class="preview-label">Pro Tips</p>
              ${ printableProTipsHtml }
            </section>

            <section class="preview-pane">
              <p class="preview-label">Reactions</p>
              <div class="preview-metrics">
                <span>Thumbs Up: ${ thumbsUp }</span>
                <span>Love: ${ love }</span>
                <span>Comments: ${ commentCount }</span>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`);

    printWindow.document.close();
    printWindow.focus();
  }

  return (
    <FilterSidebarProvider palette={ foodiesFilterPalette }>
      <FilterSidebar title="Recipe Filters">
        <FilterSidebarSearch
          value={ searchValue }
          onChange={ setSearchValue }
          placeholder="Search by recipe, chef, category, or time"
          ariaLabel="Search recipes"
        />
        <FilterSidebarDateScope
          radioName="recipe-date-scope"
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
        <FilterSidebarGroup label="Recipe Type" className="flex flex-wrap gap-2">
          <FilterSidebarRadio name="recipe-strip-mode" value="all" checked={ recipeStripMode === "all" } onChange={ () => setRecipeStripMode("all") }>All</FilterSidebarRadio>
          <FilterSidebarRadio name="recipe-strip-mode" value="latest" checked={ recipeStripMode === "latest" } onChange={ () => setRecipeStripMode("latest") }>Latest</FilterSidebarRadio>
          <FilterSidebarRadio name="recipe-strip-mode" value="top-rated" checked={ recipeStripMode === "top-rated" } onChange={ () => setRecipeStripMode("top-rated") }>Top Rated</FilterSidebarRadio>
          <FilterSidebarCheckbox checked={ includeArchived } onChange={ setIncludeArchived }>Archived</FilterSidebarCheckbox>
          <FilterSidebarCheckbox checked={ filterWithDiscussionThreads } onChange={ setFilterWithDiscussionThreads }>Discussions</FilterSidebarCheckbox>
        </FilterSidebarGroup>
      </FilterSidebar>

      <section className="font-app min-w-0 flex-1 px-4 pb-8 pt-2 sm:px-6 sm:pt-4 md:px-8">
      <div className="mx-auto max-w-7xl space-y-3 sm:space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(49,67,29,0.95),rgba(87,124,36,0.88)_56%,rgba(199,216,126,0.82))] px-4 py-5 text-white shadow-[0_28px_80px_-40px_rgba(40,54,21,0.95)] sm:px-8 sm:py-8 md:px-10">
          <div className="flex flex-col gap-3 sm:gap-5">
            <div className="max-w-3xl">
              <p className="text-[1rem] font-bold uppercase tracking-[0.28em] text-[#e9ffd0]">
                The Family Kitchen
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f1ffe4] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]">
                  <HouseHeart className="font-app mr-1.5 size-3.5 sm:mr-2 sm:size-4" />
                  Go Home
                </Link>
                <Link
                  href="/foodies/templates"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f1ffe4] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  Templates
                </Link>
                <Link
                  href="/recipe-terms"
                  className="inline-flex items-center rounded-full border border-white/35 bg-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#f1ffe4] transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-4 sm:py-2 sm:text-xs sm:tracking-[0.2em]"
                >
                  Terms
                </Link>
              </div>
              {/* <h1 className="mt-3 text-base font-black leading-snug tracking-tight sm:mt-4 sm:text-3xl">
                Keep your family&apos;s recipes together in one place
              </h1> */}
              {/* <p className="mt-3 max-w-2xl text-sm leading-7 text-[#f1ffe4] sm:text-base">
                Browse the latest uploads and top family favorites. , then add your own.
              </p> */}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="min-w-0 overflow-hidden rounded-[1.9rem] border border-white/70 bg-white/82 shadow-[0_24px_70px_-40px_rgba(38,54,26,0.75)] backdrop-blur">
            <div className="border-b border-[#dbeacc] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(245,251,235,0.88))] px-4 py-3.5 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#5f7a40]">
                    Recipe Directory
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#647a50]">
                    <h2 className="text-2xl font-black tracking-tight text-[#2f4820]">Recipe Finder</h2>
                    <FeatureFaqHelp
                      href="/feature-faq?category=The+Kitchen"
                      buttonClassName="h-4 w-4 md:h-7 md:w-7 border-[#cfe8b2] bg-gradient-to-b from-[#f7ffed] to-[#e5f7cb] text-[#4f7a2a] shadow-[0_8px_18px_rgba(79,122,42,0.2)] group-hover:shadow-[0_12px_26px_rgba(79,122,42,0.3)]"
                      iconClassName="h-3 w-3 md:h-4 md:w-4 text-[#4f7a2a]"
                      tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"
                    />
                    <EditPostIcon tooltip="Filter Recipes" tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"><FilterSidebarTrigger ariaLabel="Toggle recipe filters" /></EditPostIcon>
                    <EditPostIcon tooltip="View Recipe" tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"><Button type="button" onClick={ () => setIsViewRecipeOpen(true) } disabled={ !selectedRecipeBasic } className="h-8 shrink-0 whitespace-nowrap rounded-full border border-[#cfe8b2] bg-[#f7fce8] px-2 text-xs font-semibold text-[#2f4820] hover:bg-[#e5f7cb] disabled:opacity-50 sm:px-3" aria-label="View selected recipe"><Eye className="size-3.5" /><span className="hidden sm:inline">View</span></Button></EditPostIcon>
                    <EditPostIcon tooltip="Add Recipe" tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"><Button type="button" variant="outline" asChild className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#cfe8b2] bg-[#f7fce8] px-2 text-xs font-semibold text-[#2f4820] hover:bg-[#e5f7cb] hover:text-[#2f4820] sm:px-3"><Link href="/foodies/add-recipe" aria-label="Add recipe"><Plus className="size-3.5" /><span className="hidden sm:inline">Add</span></Link></Button></EditPostIcon>
                    { canEditSelectedRecipe ? (
                      <EditPostIcon tooltip="Edit Recipe" tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"><Button type="button" variant="outline" asChild className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#cfe8b2] bg-[#f7fce8] px-2 text-xs font-semibold text-[#2f4820] hover:bg-[#e5f7cb] hover:text-[#2f4820] sm:px-3">
                        <Link href={ `/foodies/edit-recipe/${ selectedRecipe }` } aria-label="Edit selected recipe"><Edit3 className="size-3.5" /><span className="hidden sm:inline">Edit</span></Link>
                      </Button></EditPostIcon>
                    ) : (
                      <EditPostIcon tooltip="Edit Recipe" tooltipClassName="bg-[#2f4820] text-[#f1ffe4]"><Button type="button" variant="outline" disabled className="h-8 shrink-0 whitespace-nowrap rounded-full border-[#cfe8b2] bg-[#f7fce8] px-2 text-xs font-semibold text-[#2f4820] hover:bg-[#e5f7cb] hover:text-[#2f4820] disabled:opacity-50 sm:px-3" aria-label="Edit selected recipe">
                        <Edit3 className="size-3.5" /><span className="hidden sm:inline">Edit</span>
                      </Button></EditPostIcon>
                    ) }
                  </div>
                  {/* <p className="mt-2 max-w-2xl text-sm leading-6 text-[#647a50]">
                    Search the recipe list, then select a row to keep one dish highlighted while you browse details.
                  </p> */}
                </div>

                {/* <div className="rounded-full border border-[#dbeacc] bg-[#f7fce8] px-4 py-2 text-sm font-semibold text-[#415d2c]">
                  { filteredRecipes.length } recipes found
                </div> */}
              </div>

            </div>

            <div className="mt-1 px-4 pb-2 pt-1 sm:px-6 sm:py-5">
              <FoodiesScrollStrip
                title={ stripTitle }
                description={ stripDescription }
                items={ stripItems }
                accentClassName={ stripAccentClassName }
                selectedItemId={ selectedRecipe }
                onSelectItem={ handleSelectRecipe }
                onOpenItem={ handleOpenRecipeFromCard }
              />
            </div>
          </div>
        </div>
      </div>

      <Dialog open={ isViewRecipeOpen } onOpenChange={ setIsViewRecipeOpen }>
        <DialogContent className="border-[#cadfbb] bg-[#f7fce8] sm:max-w-5xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4 pr-6">
              <div>
                <DialogTitle className="text-[#2f4820]">{ selectedRecipeBasic?.recipeTitle ?? "Recipe" }</DialogTitle>
                <DialogDescription className="mt-2 text-[#647a50]">
                  Read the selected recipe in full.
                </DialogDescription>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={ handleOpenRecipePrintPreview }
                disabled={ !selectedRecipeBasic }
                className="rounded-full border-[#cadfbb] bg-white text-[#2f4820] hover:bg-[#f1f8e4]"
              >
                <Printer className="size-4" />
                Print Preview
              </Button>
            </div>
          </DialogHeader>

          { selectedRecipeBasic ? (
            <div ref={ recipePrintContentRef } className="max-h-[75vh] space-y-4 overflow-auto pr-1">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                <RecipeViewer recipeJson={ selectedRecipeBasic.recipeJson } />

                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-[#cadfbb] bg-white">
                    <div className="relative aspect-16/10 overflow-hidden">
                      <ModalRecipeImage
                        src={ selectedRecipeBasic.recipeImageUrl ?? "/images/foodies/banana-bread-tablet.png" }
                        alt={ `${ selectedRecipeBasic.recipeTitle } recipe photo` }
                      />
                      <span className="absolute left-3 top-3 inline-flex" title={ selectedRecipeBasic.submitterName }>
                        <MemberAvatar
                          imageUrl={ selectedRecipeBasic.submitterImageUrl }
                          firstName={ selectedRecipeBasic.submitterName }
                          sizeClassName="h-10 w-10"
                          chromeClassName="border-2 border-white shadow-md"
                        />
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#cadfbb] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#5f7a40]">Summary</p>
                    <p className="mt-2 text-sm leading-6 text-[#4e6640]">
                      { selectedRecipeBasic.recipeShortSummary || "No summary provided." }
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#cadfbb] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#5f7a40]">Details</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-[#4e6640]">
                      <p><span className="font-semibold text-[#2f4820]">Submitter:</span> { selectedRecipeBasic.submitterName }</p>
                      <p><span className="font-semibold text-[#2f4820]">Updated:</span> { formatDate(selectedRecipeBasic.updatedAt) }</p>
                      <p><span className="font-semibold text-[#2f4820]">Prep:</span> { selectedRecipeBasic.prepTimeMins > 0 ? `${ selectedRecipeBasic.prepTimeMins } min` : "-" }</p>
                      <p><span className="font-semibold text-[#2f4820]">Cook:</span> { selectedRecipeBasic.cookTimeMins > 0 ? `${ selectedRecipeBasic.cookTimeMins } min` : "-" }</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#cadfbb] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#5f7a40]">Categories</p>
                    { getRecipeCategoryNames(selectedRecipeBasic).length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-[#4e6640]">
                        { getRecipeCategoryNames(selectedRecipeBasic).map((categoryName) => (
                          <span key={ categoryName } className="rounded-full bg-[#e5f7cb] px-2.5 py-1 text-xs font-semibold text-[#476232]">
                            { categoryName }
                          </span>
                        )) }
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[#647a50]">No categories added.</p>
                    ) }
                  </div>

                  <div className="rounded-2xl border border-[#cadfbb] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#5f7a40]">Pro Tips</p>
                    <div className="mt-3 space-y-3">
                      { activeRecipeDetail?.recipeProTips
                        ? activeRecipeDetail.recipeProTips.length === 0
                          ? <p className="text-sm text-[#647a50]">No pro tips were added for this recipe yet.</p>
                          : activeRecipeDetail.recipeProTips.map((proTip) => (
                            <div key={ proTip.id } className="space-y-2">
                              <RecipeProTipViewer proTipJson={ proTip.proTipJson } />
                              <p className="text-xs uppercase tracking-[0.16em] text-[#7a8f5f]">
                                { proTip.commenterName } · { formatCreatedAt(proTip.createdAt) }
                              </p>
                            </div>
                          ))
                        : <p className="text-sm text-[#647a50]">Loading pro tips...</p> }
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#cadfbb] bg-white p-4">
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#5f7a40]">Reactions</p>
                    <div className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          onClick={ () => handleToggleLike(1) }
                          disabled={ !selectedRecipeBasic || isEngaging || !canReactToSelectedRecipe }
                          className="rounded-full bg-[#578c24] text-white hover:bg-[#4a7320]"
                          aria-label={ activeRecipeDetail?.likenessDegree === 1 ? "Remove thumbs up" : "Add thumbs up" }
                        >
                          <ThumbsUp className={ `size-4 ${ activeRecipeDetail?.likenessDegree === 1 ? "fill-white" : "" }` } />
                        </Button>
                        <Button
                          type="button"
                          onClick={ () => handleToggleLike(2) }
                          disabled={ !selectedRecipeBasic || isEngaging || !canReactToSelectedRecipe }
                          className="rounded-full bg-[#d9842a] text-white hover:bg-[#b86d20]"
                          aria-label={ activeRecipeDetail?.likenessDegree === 2 ? "Remove love" : "Add love" }
                        >
                          <Heart className={ `size-4 ${ activeRecipeDetail?.likenessDegree === 2 ? "fill-white" : "" }` } />
                        </Button>
                      </div>
                      { !canReactToSelectedRecipe && selectedRecipeBasic ? (
                        <p className="text-xs text-[#647a50]">
                          You cannot react to your own recipe. Ask another family member to rate it.
                        </p>
                      ) : null }
                      <div className="flex flex-wrap gap-3 text-sm font-semibold text-[#476232]">
                        <ReactionMemberHoverCard
                          icon={ <ThumbsUp className="size-4 text-[#578c24]" /> }
                          count={ activeRecipeDetail?.thumbsUpCount ?? selectedRecipeBasic.thumbsUpCount ?? 0 }
                          memberNames={ getRecipeReactionMemberNames(
                            activeRecipeDetail?.thumbsUpCount ?? selectedRecipeBasic.thumbsUpCount ?? 0,
                            activeRecipeDetail?.thumbsUpMemberNames,
                            selectedRecipeBasic?.thumbsUpMemberNames ?? []
                          ) }
                          triggerClassName="bg-[#f7fce8]"
                          emptyLabel="Family members who liked this recipe"
                        />
                        <ReactionMemberHoverCard
                          icon={ <Heart className="size-4 fill-[#d9842a] text-[#d9842a]" /> }
                          count={ activeRecipeDetail?.loveCount ?? selectedRecipeBasic.loveCount ?? 0 }
                          memberNames={ getRecipeReactionMemberNames(
                            activeRecipeDetail?.loveCount ?? selectedRecipeBasic.loveCount ?? 0,
                            activeRecipeDetail?.loveMemberNames,
                            selectedRecipeBasic?.loveMemberNames ?? []
                          ) }
                          triggerClassName="bg-[#fff4e8]"
                          textClassName="text-[#9a5e18]"
                          emptyLabel="Family members who loved this recipe"
                        />
                        <span className="inline-flex items-center gap-2 rounded-full bg-[#f7fce8] px-3 py-1">
                          <MessageSquareText className="size-4 text-[#5d7f3f]" />
                          { activeRecipeDetail?.commentCount ?? selectedRecipeBasic.commentCount ?? 0 }
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#cadfbb] bg-white p-4">
                <div>
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#5f7a40]">Family Comments</p>
                  <p className="text-xs text-[#647a50]">Share your thoughts on this recipe with your family.</p>
                </div>

                <div className="space-y-2">
                  { selectedRecipeDetail?.id === selectedRecipe && selectedRecipeDetail.recipeComments.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[#dbeacc] bg-white px-3 py-2 text-sm text-[#647a50]">
                      No comments yet. Be the first family member to add one.
                    </p>
                  ) : selectedRecipeDetail?.id !== selectedRecipe ? (
                    <p className="rounded-2xl border border-dashed border-[#dbeacc] bg-white px-3 py-2 text-sm text-[#647a50]">
                      Loading comments...
                    </p>
                  ) : (
                    (selectedRecipeDetail?.recipeComments ?? []).map((comment) => (
                      <article key={ comment.id } className="rounded-2xl border border-[#dbeacc] bg-white px-3 py-3 text-sm text-[#4e6640]">
                        <TiptapRenderer contentJson={ comment.commentJson } />
                        <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[#7a8f5f]">
                          { comment.commenterName } · { formatCreatedAt(comment.createdAt) }
                        </p>
                      </article>
                    ))
                  ) }
                </div>

                { canCommentOnSelectedRecipe ? (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-[#2f4820]" htmlFor="recipe-comment-input-dialog">
                      Add Comment
                    </label>
                    <div id="recipe-comment-input-dialog">
                      <TipTapCommentEditor
                        value={ commentText }
                        onChange={ setCommentText }
                        placeholder="What do you think about this recipe?"
                        disabled={ !selectedRecipeBasic || isEngaging }
                        toolbarClassName="border-[#dbeacc] bg-[#f0f9df]"
                        editorClassName="border-[#dbeacc] text-[#2f4820]"
                        buttonClassName="border-[#cfe8b2] text-[#476232]"
                        activeButtonClassName="border-[#578c24] bg-[#e5f7cb] text-[#2f4820]"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={ handleAddComment }
                        disabled={ !selectedRecipeBasic || isEngaging || isSerializedTipTapDocumentEmpty(commentText) }
                        className="rounded-full bg-[#578c24] text-white hover:bg-[#4a7320]"
                      >
                        Post Comment
                      </Button>
                    </div>
                  </div>
                ) : null }
              </div>

              <div className="space-y-3 rounded-[1.4rem] border border-[#cadfbb] bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[0.68rem] font-bold uppercase tracking-[0.32em] text-[#5f7a40]">Discussion Threads</p>
                    <p className="text-xs text-[#647a50]">Follow the conversation that belongs to this recipe.</p>
                  </div>
                  <StartDiscussionDialog
                    targetType="recipe"
                    targetId={ selectedRecipeBasic.id }
                    topicLabel={ `${ selectedRecipeBasic.recipeTitle } Discussion ${ (selectedRecipeDetail?.id === selectedRecipe
                      ? selectedRecipeDetail.discussionThreads.length
                      : 0) + 1 }` }
                    revalidatePaths={ ["/foodies"] }
                    onSuccessRoute="/foodies/discussions/:threadId"
                    disabled={ isEngaging || selectedRecipeDetail?.id !== selectedRecipe }
                    triggerLabel="Add Discussion"
                    triggerClassName="rounded-full bg-[#578c24] px-4 text-xs font-semibold text-white hover:bg-[#4a7320]"
                  />
                </div>

                { selectedRecipeDetail?.id !== selectedRecipe ? (
                  <p className="rounded-2xl border border-dashed border-[#cfe8b2] bg-[#fbfff3] px-3 py-2 text-sm text-[#647a50]">
                    Loading discussion threads...
                  </p>
                ) : selectedRecipeDetail.discussionThreads.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#cfe8b2] bg-[#fbfff3] px-3 py-3 text-sm text-[#647a50]">
                    <p>No discussion threads have been added for this recipe yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    { selectedRecipeDetail.discussionThreads.map((discussionThread) => (
                      <article key={ discussionThread.id } className="rounded-2xl border border-[#cfe8b2] bg-[#fbfff7] px-4 py-4 text-sm text-[#5e7347] shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-base font-bold leading-snug text-[#2f4820]">{ discussionThread.discussTopic }</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[#7a906d]">
                              { discussionThread.memberFirstName } · { formatCreatedAt(discussionThread.createdAt) }
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-3">
                            { discussionThread.dislikeCount > 0 || discussionThread.likeCount > 0 || discussionThread.loveCount > 0 ? (
                              <div className="flex flex-wrap items-center gap-2">
                                { discussionThread.dislikeCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f4e8] px-2 py-1 text-[0.65rem] font-semibold text-[#5e7347]">
                                    <ThumbsDown className="size-3" />
                                    { discussionThread.dislikeCount }
                                  </span>
                                ) : null }
                                { discussionThread.likeCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#eef9d9] px-2 py-1 text-[0.65rem] font-semibold text-[#578c24]">
                                    <ThumbsUp className="size-3" />
                                    { discussionThread.likeCount }
                                  </span>
                                ) : null }
                                { discussionThread.loveCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fadcc7] px-2 py-1 text-[0.65rem] font-semibold text-[#c5731f]">
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
                              className="shrink-0 rounded-full border-[#cfe8b2] bg-white px-4 text-xs font-semibold text-[#2f4820] hover:bg-[#f7fce8] hover:text-[#2f4820]"
                            >
                              <Link href={ `/foodies/discussions/${ discussionThread.id }` }>
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

function ModalRecipeImage({ src, alt }: { src: string; alt: string }) {
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