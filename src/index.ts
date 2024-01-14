import { UserConfig, PluginOption } from "vite"
import { OutputChunk, OutputAsset, OutputOptions } from "rollup"
import micromatch from "micromatch"

export type Config = {
	// Modifies the Vite build config to make this plugin work well. See `_useRecommendedBuildConfig`
	// in the plugin implementation for more details on how this works.
	//
	// @default true
	useRecommendedBuildConfig?: boolean
	// Remove the unused Vite module loader. Safe to do since all JS is inlined by this plugin.
	//
	// @default false
	removeViteModuleLoader?: boolean
	// Optionally, only inline assets that match one or more glob patterns.
	//
	// @default []
	inlinePattern?: string[]
	// Optionally, delete inlined assets preventing them from being output.
	//
	// @default true
	deleteInlinedFiles?: boolean
}

const defaultConfig = { useRecommendedBuildConfig: true, removeViteModuleLoader: false, deleteInlinedFiles: true }

export function replaceScript(html: string, scriptFilename: string, scriptCode: string, removeViteModuleLoader = false): string {
	const reScript = new RegExp(`<script([^>]*?) src="[./]*${scriptFilename}"([^>]*)></script>`)
	// we can't use String.prototype.replaceAll since it isn't supported in Node.JS 14
	const preloadMarker = /"__VITE_PRELOAD__"/g
	const newCode = scriptCode.replace(preloadMarker, "void 0")
	const inlined = html.replace(reScript, (_, beforeSrc, afterSrc) => `<script${beforeSrc}${afterSrc}>\n${newCode}\n</script>`)
	return removeViteModuleLoader ? _removeViteModuleLoader(inlined) : inlined
}

export function replaceCss(html: string, scriptFilename: string, scriptCode: string): string {
	const reStyle = new RegExp(`<link([^>]*?) href="[./]*${scriptFilename}"([^>]*?)>`)
	const inlined = html.replace(reStyle, (_, beforeSrc, afterSrc) => `<style${beforeSrc}${afterSrc}>\n${scriptCode}\n</style>`);
	return inlined
}

const warnNotInlined = (filename: string) => console.warn(`WARNING: asset not inlined: ${filename}`)

export function viteSingleFile({
	useRecommendedBuildConfig = true,
	removeViteModuleLoader = false,
	inlinePattern = [],
	deleteInlinedFiles = true,
}: Config = defaultConfig): PluginOption {
	return {
		name: "vite:singlefile",
		config: useRecommendedBuildConfig ? _useRecommendedBuildConfig : undefined,
		enforce: "post",
		generateBundle: (_, bundle) => {
			const jsExtensionTest = /\.[mc]?js$/
			const htmlFiles = Object.keys(bundle).filter((i) => i.endsWith(".html"))
			const cssAssets = Object.keys(bundle).filter((i) => i.endsWith(".css"))
			const jsAssets = Object.keys(bundle).filter((i) => jsExtensionTest.test(i))
			const bundlesToDelete = [] as string[]
			for (const name of htmlFiles) {
				const htmlChunk = bundle[name] as OutputAsset
				let replacedHtml = htmlChunk.source as string
				for (const jsName of jsAssets) {
					if (!inlinePattern.length || micromatch.isMatch(jsName, inlinePattern)) {
						const jsChunk = bundle[jsName] as OutputChunk
						if (jsChunk.code != null) {
							bundlesToDelete.push(jsName)
							replacedHtml = replaceScript(replacedHtml, jsChunk.fileName, jsChunk.code, removeViteModuleLoader)
						}
					} else {
						warnNotInlined(jsName)
					}
				}
				for (const cssName of cssAssets) {
					if (!inlinePattern.length || micromatch.isMatch(cssName, inlinePattern)) {
						const cssChunk = bundle[cssName] as OutputAsset
						bundlesToDelete.push(cssName)
						replacedHtml = replaceCss(replacedHtml, cssChunk.fileName, cssChunk.source as string)
					} else {
						warnNotInlined(cssName)
					}
				}
				htmlChunk.source = replacedHtml
			}
			if (deleteInlinedFiles) {
				for (const name of bundlesToDelete) {
					delete bundle[name]
				}
			}
			for (const name of Object.keys(bundle).filter((i) => !jsExtensionTest.test(i) && !i.endsWith(".css") && !i.endsWith(".html"))) {
				warnNotInlined(name)
			}
		},
	}
}

// Optionally remove the Vite module loader since it's no longer needed because this plugin has inlined all code.
// This assumes that the Module Loader is (1) the FIRST function declared in the module, (2) an IIFE, (4) is within
// a script with no unexpected attribute values, and (5) that the containing script is the first script tag that
// matches the above criteria. Changes to the SCRIPT tag especially could break this again in the future. It should
// work whether `minify` is enabled or not.
// Update example:
// https://github.com/richardtallent/vite-plugin-singlefile/issues/57#issuecomment-1263950209
const _removeViteModuleLoader = (html: string) =>
	html.replace(/(<script type="module" crossorigin>\s*)\(function(?: polyfill)?\(\)\s*\{[\s\S]*?\}\)\(\);/, '<script type="module">\n')

// Modifies the Vite build config to make this plugin work well.
const _useRecommendedBuildConfig = (config: UserConfig) => {
	if (!config.build) config.build = {}
	// Ensures that even very large assets are inlined in your JavaScript.
	config.build.assetsInlineLimit = 100000000
	// Avoid warnings about large chunks.
	config.build.chunkSizeWarningLimit = 100000000
	// Emit all CSS as a single file, which `vite-plugin-singlefile` can then inline.
	config.build.cssCodeSplit = false
	// We need relative path to support any static files in public folder,
	// which are copied to ${build.outDir} by vite.
	config.base = './'
	// Make generated files in ${build.outDir}'s root, instead of default ${build.outDir}/assets.
	// Then the embedded resources can be loaded by relative path.
    config.build.assetsDir = ''

	if (!config.build.rollupOptions) config.build.rollupOptions = {}
	if (!config.build.rollupOptions.output) config.build.rollupOptions.output = {}

	const updateOutputOptions = (out: OutputOptions) => {
		// Ensure that as many resources as possible are inlined.
		out.inlineDynamicImports = true
	}

	if (Array.isArray(config.build.rollupOptions.output)) {
		for (const o in config.build.rollupOptions.output) updateOutputOptions(o as OutputOptions)
	} else {
		updateOutputOptions(config.build.rollupOptions.output as OutputOptions)
	}
}
