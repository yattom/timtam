"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

interface Meeting {
  meetingId: string;
  platform: string;
  status: string;
  meetingCode?: string;
  createdAt: number;
  endedAt?: number;
  recallBot?: {
    meetingUrl: string;
    platform: string;
    status: string;
  };
}

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);

  // Fetch meetings from API
  const fetchMeetings = useCallback(async (token?: string | null, append = false) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
      const url = new URL(`${apiUrl}/recall/meetings`);
      url.searchParams.set('limit', '50');
      if (token) {
        url.searchParams.set('nextToken', token);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        let errorMessage = `API error: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData && typeof errorData === "object") {
            if (typeof (errorData as any).error === "string") {
              errorMessage += ` - ${(errorData as any).error}`;
            } else if (typeof (errorData as any).message === "string") {
              errorMessage += ` - ${(errorData as any).message}`;
            }
          } else if (typeof errorData === "string") {
            errorMessage += ` - ${errorData}`;
          }
        } catch {
          // Ignore JSON parsing errors and fall back to status-only message
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (append) {
        setMeetings((prev) => [...prev, ...(data.meetings || [])]);
      } else {
        setMeetings(data.meetings || []);
      }
      
      setNextToken(data.nextToken || null);
      setError(null);
    } catch (err: any) {
      console.error("Failed to fetch meetings:", err);
      setError(err.message || "会議リストの取得に失敗しました");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMoreMeetings = useCallback(() => {
    if (nextToken && !loadingMore) {
      fetchMeetings(nextToken, true);
    }
  }, [nextToken, loadingMore, fetchMeetings]);

  useEffect(() => {
    // Initial fetch
    fetchMeetings();

    // Poll every minute (60000ms) - only refreshes first page to show latest meetings
    const interval = setInterval(() => fetchMeetings(), 60000);

    return () => clearInterval(interval);
  }, [fetchMeetings]);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                Timtam Facilitator
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/meetings/join"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                新しい会議に参加
              </Link>
              <Link
                href="/config"
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors"
              >
                Grasp設定
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            会議リスト
          </h2>
          <p className="text-gray-600">
            全ての会議（進行中・終了済み）を最新順で表示
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-2 text-gray-600">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-red-800">{error}</p>
          </div>
        ) : meetings.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <p className="text-gray-600 mb-4">会議がありません</p>
            <Link
              href="/meetings/join"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              新しい会議に参加
            </Link>
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              {meetings.map((meeting) => {
                const createdDate = new Date(meeting.createdAt);
                const endedDate = meeting.endedAt
                  ? new Date(meeting.endedAt)
                  : null;

                return (
                  <div
                    key={meeting.meetingId}
                    className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            meeting.status === "active"
                              ? "bg-green-500"
                              : "bg-gray-400"
                          }`}
                        ></div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {meeting.status === "active" ? "進行中" : "終了"}
                          </h3>
                          <p className="text-sm text-gray-600">
                            コード: {meeting.meetingCode || "N/A"}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/meetings/detail?id=${meeting.meetingId}`}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                      >
                        詳細を見る
                      </Link>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>
                        開始: {createdDate.toLocaleString("ja-JP")}
                      </p>
                      {endedDate && (
                        <p>
                          終了: {endedDate.toLocaleString("ja-JP")}
                        </p>
                      )}
                      {meeting.recallBot && (
                        <>
                          <p className="truncate">
                            URL: {meeting.recallBot.meetingUrl}
                          </p>
                          <p>
                            Platform: {meeting.recallBot.platform} | Bot Status:{" "}
                            {meeting.recallBot.status}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {nextToken && (
              <div className="mt-6 text-center">
                <button
                  onClick={loadMoreMeetings}
                  disabled={loadingMore}
                  className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loadingMore ? (
                    <span className="flex items-center justify-center">
                      <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                      読み込み中...
                    </span>
                  ) : (
                    "さらに読み込む"
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
