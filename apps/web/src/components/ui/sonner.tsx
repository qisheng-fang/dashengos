import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-oklch(1 0 0) group-[.toaster]:text-oklch(0.141 0.005 285.823) group-[.toaster]:border-oklch(0.92 0.004 286.32) group-[.toaster]:shadow-lg dark:group-[.toaster]:bg-oklch(0.141 0.005 285.823) dark:group-[.toaster]:text-oklch(0.985 0 0) dark:group-[.toaster]:border-oklch(1 0 0 / 10%)",
          description: "group-[.toast]:text-oklch(0.552 0.016 285.938) dark:group-[.toast]:text-oklch(0.705 0.015 286.067)",
          actionButton:
            "group-[.toast]:bg-oklch(0.21 0.006 285.885) group-[.toast]:text-oklch(0.985 0 0) dark:group-[.toast]:bg-oklch(0.92 0.004 286.32) dark:group-[.toast]:text-oklch(0.21 0.006 285.885)",
          cancelButton:
            "group-[.toast]:bg-oklch(0.967 0.001 286.375) group-[.toast]:text-oklch(0.552 0.016 285.938) dark:group-[.toast]:bg-oklch(0.274 0.006 286.033) dark:group-[.toast]:text-oklch(0.705 0.015 286.067)",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
