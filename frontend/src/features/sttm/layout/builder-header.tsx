"use client";
import { AiaAvatar, AiaBox, AiaButton } from '@/components/ui';
import { AiaText } from '@/components/ui/aia-text';
import Image from "next/image";
import { EastRoundedIcon, KeyboardArrowDownRoundedIcon } from '@/utils/icons';




type BuilderHeaderProps = {
  userName?: string;
  role?: string;
  currentStep?: 1 | 2;
  onProceed?: () => void;
};

const steps = [
  { id: 1, label: "Select Tables" },
  { id: 2, label: "Map, Transform and Validate" },
] as const;

export default function BuilderHeader({
  userName = "Shane Watson",
  role = "Publisher",
  currentStep = 1,
  onProceed,
}: BuilderHeaderProps) {
  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AiaBox className="flex h-[84px] w-full items-center justify-between border-b border-[#a8a8a8] bg-white px-6" sx={{backgroundColor: '#f9f9f9', borderBottomWidth: '1px'}}>
      <AiaBox className="flex items-center gap-3">
        <AiaBox className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl bg-white">
          <Image
            src="/images/focus_home_logo.svg"
            alt="STTM Builder Logo"
            width={44}
            height={44}
            className="object-contain"
          />
        </AiaBox>

        <AiaBox>
          <AiaText className="text-[17px] font-bold text-[#111827]">
            STTM Builder
          </AiaText>
          <AiaText className="text-[12px] text-[#6B7280]">
            Source To Target Mapping
          </AiaText>
        </AiaBox>
      </AiaBox>
      <AiaBox className="flex items-center">
          {steps.map((step, index) => {
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <AiaBox key={step.id} className="flex items-center">
                <AiaBox className="flex items-center gap-3">
                  <AiaBox
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-[13px] font-semibold ${
                      isActive || isCompleted
                        ? "border-[#2563EB] bg-[#2563EB] text-white"
                        : "border-[#D1D5DB] bg-white text-[#9CA3AF]"
                    }`}
                  >
                    {step.id}
                  </AiaBox>

                  <AiaText
                    className={`text-[13px] font-medium ${
                      isActive || isCompleted
                        ? "text-[#111827]"
                        : "text-[#9CA3AF]"
                    }`}
                  >
                    {step.label}
                  </AiaText>
                </AiaBox>

                {index < steps.length - 1 ? (
                  <AiaBox
                    className={`mx-4 h-[2px] w-16 rounded-full ${
                      currentStep > step.id ? "bg-[#2563EB]" : "bg-[#E5E7EB]"
                    }`}
                  />
                ) : null}
              </AiaBox>
            );
          })}
        </AiaBox>

      <AiaBox className="flex items-center gap-4">


        <AiaButton
          variant="contained"
         endIcon={<EastRoundedIcon />}
          onClick={onProceed}
          className="rounded-xl bg-[#0073a0] px-4 py-2 normal-case shadow-none hover:bg-[#1D4ED8]"
        >
          Proceed Mapping
        </AiaButton>

        <AiaBox className="flex items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2">
          <AiaAvatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: "#E2E8F0",
              color: "#0F172A",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {initials}
          </AiaAvatar>

          <AiaBox className="leading-tight">
            <AiaText className="text-[14px] font-semibold text-[#111827]">
              {userName}
            </AiaText>
            <AiaText className="text-[12px] text-[#6B7280]">
              {role}
            </AiaText>
          </AiaBox>

          {/* <KeyboardArrowDownRoundedIcon sx={{ fontSize: 20, color: "#6B7280" }} /> */}
        </AiaBox>
      </AiaBox>
    </AiaBox>
  );
}
