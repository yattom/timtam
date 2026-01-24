"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

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
  const [error, setError] = useState<string | null>(null);

  // Fetch meetings from API
  const fetchMeetings = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
      const response = await fetch(`${apiUrl}/recall/meetings`);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      setMeetings(data.meetings || []);
      setError(null);
    } catch (err: any) {
      console.error("Failed to fetch meetings:", err);
      setError(err.message || "会議リストの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchMeetings();

    // Poll every minute (60000ms)
    const interval = setInterval(fetchMeetings, 60000);

    return () => clearInterval(interval);
  }, []);

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
        )}
      </main>
    </div>
  );
}
