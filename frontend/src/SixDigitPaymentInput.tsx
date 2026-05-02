import React, { useRef } from "react";

const SixDigitPaymentInput = ({ code, setCode }: { code: string; setCode: (value: string) => void }) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = code.padEnd(6, " ").split("").slice(0, 6);

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const chars = [...digits];
    chars[index] = value;
    setCode(chars.join(""));
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace") return;

    const chars = [...digits];
    if (digits[index].trim()) {
      chars[index] = " ";
      setCode(chars.join(""));
      return;
    }

    if (index === 0) return;
    chars[index - 1] = " ";
    setCode(chars.join(""));
    inputRefs.current[index - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    setCode(pasted.padEnd(6, " "));
    inputRefs.current[Math.max(0, Math.min(pasted.length, 5))]?.focus();
  };

  return (
    <div className="six-digit-input">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit.trim()}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className="digit-box"
        />
      ))}
    </div>
  );
};

export default SixDigitPaymentInput;
