using UnrealBuildTool;

[SupportedPlatforms("Win64")]
public class UnrealPackageInsightBackendTarget : TargetRules
{
	public UnrealPackageInsightBackendTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Program;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		LinkType = TargetLinkType.Monolithic;
		LaunchModuleName = "UnrealPackageInsightBackend";

		bShouldCompileAsDLL = true;
		bHasExports = true;

		bBuildDeveloperTools = false;
		bBuildWithEditorOnlyData = false;
		bCompileAgainstEngine = false;
		bCompileAgainstCoreUObject = false;
		bCompileAgainstApplicationCore = false;
		bCompileICU = false;
		bUsesSlate = false;

		OutputFile = "Binaries/Win64/UnrealPackageInsightBackend/UnrealPackageInsightBackend.dll";
	}
}
