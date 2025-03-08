import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  Loader2Icon,
  LockIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { readAICourseLessonStream } from '../../helper/read-stream';
import { cn } from '../../lib/classname';
import { isLoggedIn, removeAuthToken } from '../../lib/jwt';
import {
  markdownToHtml,
  markdownToHtmlWithHighlighting,
} from '../../lib/markdown';
import { httpPatch } from '../../lib/query-http';
import { slugify } from '../../lib/slugger';
import {
  getAiCourseLimitOptions,
  getAiCourseProgressOptions,
  type AICourseProgressDocument,
} from '../../queries/ai-course';
import { queryClient } from '../../stores/query-client';
import { AICourseFollowUp } from './AICourseFollowUp';
import './AICourseFollowUp.css';

type AICourseModuleViewProps = {
  courseSlug: string;

  activeModuleIndex: number;
  totalModules: number;
  currentModuleTitle: string;
  activeLessonIndex: number;
  totalLessons: number;
  currentLessonTitle: string;

  onGoToPrevLesson: () => void;
  onGoToNextLesson: () => void;
};

export function AICourseModuleView(props: AICourseModuleViewProps) {
  const {
    courseSlug,

    activeModuleIndex,
    totalModules,
    currentModuleTitle,
    activeLessonIndex,
    totalLessons,
    currentLessonTitle,

    onGoToPrevLesson,
    onGoToNextLesson,
  } = props;

  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  const [lessonHtml, setLessonHtml] = useState('');
  const { data: aiCourseProgress } = useQuery(
    getAiCourseProgressOptions({ aiCourseSlug: courseSlug || '' }),
    queryClient,
  );

  const lessonId = `${slugify(currentModuleTitle)}__${slugify(currentLessonTitle)}`;
  const isLessonDone = aiCourseProgress?.done.includes(lessonId);

  const abortController = useMemo(
    () => new AbortController(),
    [activeModuleIndex, activeLessonIndex],
  );

  const generateAiCourseContent = async () => {
    setIsLoading(true);
    setError('');
    setLessonHtml('');

    if (!isLoggedIn()) {
      setIsLoading(false);
      setError('Please login to generate course content');
      return;
    }

    if (!currentModuleTitle || !currentLessonTitle) {
      setIsLoading(false);
      setError('Invalid module title or lesson title');
      return;
    }

    const response = await fetch(
      `${import.meta.env.PUBLIC_API_URL}/v1-generate-ai-course-lesson/${courseSlug}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        credentials: 'include',
        body: JSON.stringify({
          moduleTitle: currentModuleTitle,
          lessonTitle: currentLessonTitle,
          modulePosition: activeModuleIndex,
          lessonPosition: activeLessonIndex,
          totalLessonsInModule: totalLessons,
        }),
      },
    );

    if (!response.ok) {
      const data = await response.json();

      setError(data?.message || 'Something went wrong');
      setIsLoading(false);

      // Logout user if token is invalid
      if (data.status === 401) {
        removeAuthToken();
        window.location.reload();
      }
    }

    const reader = response.body?.getReader();

    if (!reader) {
      setIsLoading(false);
      setError('Something went wrong');
      return;
    }

    setIsLoading(false);
    setIsGenerating(true);
    await readAICourseLessonStream(reader, {
      onStream: async (result) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLessonHtml(markdownToHtml(result, false));
      },
      onStreamEnd: async (result) => {
        if (abortController.signal.aborted) {
          return;
        }

        setLessonHtml(await markdownToHtmlWithHighlighting(result));
        queryClient.invalidateQueries(getAiCourseLimitOptions());
        setIsGenerating(false);
      },
    });
  };

  const { mutate: toggleDone, isPending: isTogglingDone } = useMutation(
    {
      mutationFn: () => {
        return httpPatch<AICourseProgressDocument>(
          `/v1-toggle-done-ai-lesson/${courseSlug}`,
          {
            lessonId,
          },
        );
      },
      onSuccess: (data) => {
        queryClient.setQueryData(
          ['ai-course-progress', { aiCourseSlug: courseSlug }],
          data,
        );
      },
    },
    queryClient,
  );

  useEffect(() => {
    generateAiCourseContent();
  }, [currentModuleTitle, currentLessonTitle]);

  useEffect(() => {
    return () => {
      abortController.abort();
    };
  }, [abortController]);

  const cantGoForward =
    (activeModuleIndex === totalModules - 1 &&
      activeLessonIndex === totalLessons - 1) ||
    isGenerating ||
    isLoading;

  const cantGoBack =
    (activeModuleIndex === 0 && activeLessonIndex === 0) || isGenerating;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm max-lg:px-4 max-lg:pb-4 max-lg:pt-3">
        {(isGenerating || isLoading) && (
          <div className="absolute right-3 top-3 flex items-center justify-center">
            <Loader2Icon
              size={18}
              strokeWidth={3}
              className="animate-spin text-gray-400/70"
            />
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Lesson {activeLessonIndex + 1} of {totalLessons}
          </div>

          {!isGenerating && !isLoading && (
            <>
              <button
                disabled={isLoading || isTogglingDone}
                className={cn(
                  'absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black py-1 pl-2 pr-3 text-sm text-white hover:bg-gray-800 disabled:opacity-50 max-lg:text-xs',
                  isLessonDone
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-green-500 hover:bg-green-600',
                )}
                onClick={() => toggleDone()}
              >
                {isTogglingDone ? (
                  <>
                    <Loader2Icon
                      size={16}
                      strokeWidth={3}
                      className="animate-spin text-white"
                    />
                    Please wait ...
                  </>
                ) : (
                  <>
                    {isLessonDone ? (
                      <>
                        <XIcon size={16} />
                        Mark as Undone
                      </>
                    ) : (
                      <>
                        <CheckIcon size={16} />
                        Mark as Done
                      </>
                    )}
                  </>
                )}
              </button>
            </>
          )}
        </div>

        <h1 className="mb-6 text-balance text-3xl font-semibold max-lg:mb-3 max-lg:text-xl">
          {currentLessonTitle?.replace(/^Lesson\s*?\d+[\.:]\s*/, '')}
        </h1>

        {!error && isLoggedIn() && (
          <div
            className="course-content prose prose-lg mt-8 max-w-full text-black prose-headings:mb-3 prose-headings:mt-8 prose-blockquote:font-normal prose-pre:rounded-2xl prose-pre:text-lg prose-li:my-1 prose-thead:border-zinc-800 prose-tr:border-zinc-800 max-lg:mt-4 max-lg:text-base max-lg:prose-h2:mt-3 max-lg:prose-h2:text-lg max-lg:prose-h3:text-base max-lg:prose-pre:px-3 max-lg:prose-pre:text-sm"
            dangerouslySetInnerHTML={{ __html: lessonHtml }}
          />
        )}

        {error && isLoggedIn() && (
          <div className="mt-8 flex items-center justify-center">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {!isLoggedIn() && (
          <div className="mt-8 flex flex-col items-center justify-center gap-4 rounded-lg border border-gray-200 p-8">
            <LockIcon className="size-10 stroke-[2.5] text-gray-400" />
            <p className="text-sm text-gray-500">
              Please login to generate course content
            </p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={onGoToPrevLesson}
            disabled={cantGoBack}
            className={cn(
              'flex items-center rounded-full px-4 py-2 disabled:opacity-50 max-lg:px-3 max-lg:py-1.5 max-lg:text-sm',
              cantGoBack
                ? 'cursor-not-allowed text-gray-400'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
            )}
          >
            <ChevronLeft size={16} className="mr-2" />
            Previous <span className="hidden lg:inline">&nbsp;Lesson</span>
          </button>

          <button
            onClick={onGoToNextLesson}
            disabled={cantGoForward}
            className={cn(
              'flex items-center rounded-full px-4 py-2 disabled:opacity-50 max-lg:px-3 max-lg:py-1.5 max-lg:text-sm',
              cantGoForward
                ? 'cursor-not-allowed text-gray-400'
                : 'bg-gray-800 text-white hover:bg-gray-700',
            )}
          >
            Next <span className="hidden lg:inline">&nbsp;Lesson</span>
            <ChevronRight size={16} className="ml-2" />
          </button>
        </div>
      </div>

      {!isGenerating && !isLoading && (
        <AICourseFollowUp
          courseSlug={courseSlug}
          moduleTitle={currentModuleTitle}
          lessonTitle={currentLessonTitle}
        />
      )}
    </div>
  );
}
