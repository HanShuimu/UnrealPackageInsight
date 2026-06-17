using System.IO;
using UnrealBuildTool;

public class UnrealPackageInsightBackend : ModuleRules
{
	public UnrealPackageInsightBackend(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PrivateIncludePaths.AddRange(
			new string[]
			{
				ResolveGeneratedCppIncludePath(ModuleDirectory),
				Path.Combine(EngineDirectory, "Source", "Runtime", "Core", "Internal")
			}
		);

		AddEngineThirdPartyPrivateStaticDependencies(Target, "Flatbuffers");

		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
				"PakFile"
			}
		);
	}

	private static string ResolveGeneratedCppIncludePath(string ModuleDirectory)
	{
		string GeneratedProtocolPath = Path.GetFullPath(Path.Combine(ModuleDirectory, "Generated", "Protocol"));
		if (Directory.Exists(GeneratedProtocolPath))
		{
			return GeneratedProtocolPath;
		}

		throw new BuildException($"Generated protocol C++ includes are missing at {GeneratedProtocolPath}. Run npm.cmd --prefix node-shell run generate-protocol from the UnrealPackageInsight repo root before building the native backend.");
	}
}
