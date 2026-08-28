
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/" | "/attempt-placeholder" | "/login" | "/student" | "/student/grievances" | "/student/grievances/new" | "/student/grievances/[id]" | "/warden" | "/warden/grievances" | "/warden/grievances/[id]";
		RouteParams(): {
			"/student/grievances/[id]": { id: string };
			"/warden/grievances/[id]": { id: string }
		};
		LayoutParams(): {
			"/": { id?: string | undefined };
			"/attempt-placeholder": Record<string, never>;
			"/login": Record<string, never>;
			"/student": { id?: string | undefined };
			"/student/grievances": { id?: string | undefined };
			"/student/grievances/new": Record<string, never>;
			"/student/grievances/[id]": { id: string };
			"/warden": { id?: string | undefined };
			"/warden/grievances": { id?: string | undefined };
			"/warden/grievances/[id]": { id: string }
		};
		Pathname(): "/" | "/attempt-placeholder" | "/login" | "/student" | "/student/grievances" | "/student/grievances/new" | `/student/grievances/${string}` & {} | "/warden" | "/warden/grievances" | `/warden/grievances/${string}` & {};
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/robots.txt" | string & {};
	}
}