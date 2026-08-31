export interface VideoFormat {
  formatId: string;
  ext: string;
  resolution?: string;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  quality?: string;
}

export interface VideoMetadata {
  title: string;
  duration: number;
  thumbnail: string;
  formats: VideoFormat[];
  subtitles: Record<string, unknown>;
  automaticCaptions: Record<string, unknown>;
}

export interface DownloadJob {
  id: string;
  url: string;
  title?: string;
  status: "queued" | "downloading" | "processing" | "uploading" | "completed" | "failed" | "cancelled";
  format?: string;
  quality?: string;
  progress: number;
  speed?: string;
  eta?: number;
  errorMessage?: string;
  parentJobId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  files?: DownloadFile[];
}

export interface DownloadFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface BackendAdapter {
  getMetadata(url: string): Promise<{ jobId: string; status: string }>;
  getMetadataResult(jobId: string): Promise<DownloadJob>;
  createDownload(options: {
    url: string;
    format?: string;
    quality?: string;
    subtitleOptions?: Record<string, unknown>;
    postProcessOptions?: Record<string, unknown>;
  }): Promise<{ id: string; status: string }>;
  getDownload(jobId: string): Promise<DownloadJob>;
  getDownloads(params?: { limit?: number; offset?: number; status?: string }): Promise<DownloadJob[]>;
  cancelDownload(jobId: string): Promise<void>;
  subscribeToProgress(jobId: string, onEvent: (event: DownloadJob) => void): () => void;
}

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  return res;
}

export const webBackend: BackendAdapter = {
  async getMetadata(url: string) {
    const res = await fetchWithAuth("/metadata", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    return res.json();
  },

  async getMetadataResult(jobId: string) {
    const res = await fetchWithAuth(`/metadata/${jobId}`);
    return res.json();
  },

  async createDownload(options) {
    const res = await fetchWithAuth("/downloads", {
      method: "POST",
      body: JSON.stringify(options),
    });
    return res.json();
  },

  async getDownload(jobId: string) {
    const res = await fetchWithAuth(`/downloads/${jobId}`);
    return res.json();
  },

  async getDownloads(params) {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", params.limit.toString());
    if (params?.offset) search.set("offset", params.offset.toString());
    if (params?.status) search.set("status", params.status);

    const res = await fetchWithAuth(`/downloads?${search.toString()}`);
    return res.json();
  },

  async cancelDownload(jobId: string) {
    const res = await fetchWithAuth(`/downloads/${jobId}/cancel`, { method: "POST" });
    return res.json();
  },

  subscribeToProgress(jobId: string, onEvent: (event: DownloadJob) => void) {
    const eventSource = new EventSource(`${API_BASE}/downloads/${jobId}/events`, {
      withCredentials: true,
    });

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data as DownloadJob);
      } catch {
        // ignore parse errors
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  },
};

export const desktopBackend: BackendAdapter = {
  async getMetadata(url: string) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("get_video_info", { url });
    }
    throw new Error("Tauri not available");
  },

  async getMetadataResult(jobId: string) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("get_download_job", { jobId });
    }
    throw new Error("Tauri not available");
  },

  async createDownload(options) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("download_video", options);
    }
    throw new Error("Tauri not available");
  },

  async getDownload(jobId: string) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("get_download_job", { jobId });
    }
    throw new Error("Tauri not available");
  },

  async getDownloads(params) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("get_download_jobs", params || {});
    }
    throw new Error("Tauri not available");
  },

  async cancelDownload(jobId: string) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke("stop_download", { jobId });
    }
    throw new Error("Tauri not available");
  },

  subscribeToProgress(jobId: string, onEvent: (event: DownloadJob) => void) {
    if (typeof window !== "undefined" && (window as { __TAURI__?: unknown }).__TAURI__) {
      import("@tauri-apps/api/event").then(({ listen }) => {
        listen(`download-progress-${jobId}`, (event) => {
          onEvent(event.payload as DownloadJob);
        });
      });
    }
    return () => {};
  },
};

export function getBackend(): BackendAdapter {
  const isWeb = import.meta.env.VITE_WEB_MODE === "true" ||
    (typeof window !== "undefined" && !!(window as { __TAURI__?: unknown }).__TAURI__ === false);

  return isWeb ? webBackend : desktopBackend;
}

