// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="vite-plugin-pwa/client" />

// Import chat types from dedicated module

import type {
	// API types
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta,
	ApiChatMessageData,
	ApiChatMessageContentPart,
	ApiContextSizeError,
	ApiErrorResponse,
	ApiLlamaCppServerProps,
	ApiModelDataEntry,
	ApiModelListResponse,
	ApiProcessingState,
	ApiRouterModelMeta,
	ApiRouterModelsLoadRequest,
	ApiRouterModelsLoadResponse,
	ApiRouterModelsStatusRequest,
	ApiRouterModelsStatusResponse,
	ApiRouterModelsListResponse,
	ApiRouterModelsUnloadRequest,
	ApiRouterModelsUnloadResponse,
	// Chat types
	ChatAttachmentDisplayItem,
	ChatAttachmentPreviewItem,
	ChatMessageType,
	ChatRole,
	ChatUploadedFile,
	ChatMessageSiblingInfo,
	ChatMessagePromptProgress,
	ChatMessageTimings,
	// Database types
	DatabaseConversation,
	DatabaseMessage,
	DatabaseMessageExtra,
	DatabaseMessageExtraAudioFile,
	DatabaseMessageExtraImageFile,
	DatabaseMessageExtraTextFile,
	DatabaseMessageExtraPdfFile,
	DatabaseMessageExtraLegacyContext,
	ExportedConversation,
	ExportedConversations,
	// Model types
	ModelModalities,
	ModelOption,
	// Settings types
	SettingsChatServiceOptions,
	SettingsConfigValue,
	SettingsFieldConfig,
	SettingsConfigType
} from '$lib/types';

import { ServerRole, ServerModelStatus, ModelModality } from '$lib/enums';

declare global {
	namespace App {
		interface Locals {
			session: {
				id: string;
				userId: string;
				displayName: string;
			} | null;
		}

		interface PageData {
			session: App.Locals['session'];
		}
	}
}

declare module 'virtual:pwa-register' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
		onRegisterError?: (error: unknown) => void;
	}

	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}

declare global {
	export {
		// API types
		ApiChatCompletionRequest,
		ApiChatCompletionResponse,
		ApiChatCompletionStreamChunk,
		ApiChatCompletionToolCall,
		ApiChatCompletionToolCallDelta,
		ApiChatMessageData,
		ApiChatMessageContentPart,
		ApiContextSizeError,
		ApiErrorResponse,
		ApiLlamaCppServerProps,
		ApiModelDataEntry,
		ApiModelListResponse,
		ApiProcessingState,
		ApiRouterModelMeta,
		ApiRouterModelsLoadRequest,
		ApiRouterModelsLoadResponse,
		ApiRouterModelsStatusRequest,
		ApiRouterModelsStatusResponse,
		ApiRouterModelsListResponse,
		ApiRouterModelsUnloadRequest,
		ApiRouterModelsUnloadResponse,
		// Chat types
		ChatAttachmentDisplayItem,
		ChatAttachmentPreviewItem,
		ChatMessagePromptProgress,
		ChatMessageSiblingInfo,
		ChatMessageTimings,
		ChatMessageType,
		ChatRole,
		ChatUploadedFile,
		// Database types
		DatabaseConversation,
		DatabaseMessage,
		DatabaseMessageExtra,
		DatabaseMessageExtraAudioFile,
		DatabaseMessageExtraImageFile,
		DatabaseMessageExtraTextFile,
		DatabaseMessageExtraPdfFile,
		DatabaseMessageExtraLegacyContext,
		ExportedConversation,
		ExportedConversations,
		// Enum types
		ModelModality,
		ServerRole,
		ServerModelStatus,
		// Model types
		ModelModalities,
		ModelOption,
		// Settings types
		SettingsChatServiceOptions,
		SettingsConfigValue,
		SettingsFieldConfig,
		SettingsConfigType
	};
}

declare global {
	interface Window {
		idxThemeStyle?: number;
		idxCodeBlock?: number;
	}
}
