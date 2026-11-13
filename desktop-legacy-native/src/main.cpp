#include <wx/wx.h>
#include <wx/aboutdlg.h>

class SchoolBridgeFrame final : public wxFrame {
public:
    SchoolBridgeFrame()
        : wxFrame(nullptr, wxID_ANY, "SchoolBridge — Legacy Native Shell",
                  wxDefaultPosition, wxSize(960, 640)) {
        auto* panel = new wxPanel(this);
        auto* root = new wxBoxSizer(wxVERTICAL);
        auto* heading = new wxStaticText(panel, wxID_ANY, "SchoolBridge");
        wxFont headingFont = heading->GetFont();
        headingFont.SetPointSize(22);
        headingFont.SetWeight(wxFONTWEIGHT_BOLD);
        heading->SetFont(headingFont);
        auto* status = new wxStaticText(
            panel, wxID_ANY,
            "Native desktop proof of concept\n"
            "Uses wxWidgets native controls; no WebView2 or external browser.\n\n"
            "Windows 8.0 compatibility is NOT yet certified.");
        auto* about = new wxButton(panel, wxID_ABOUT, "About this prototype");
        about->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) {
            wxAboutDialogInfo info;
            info.SetName("SchoolBridge Legacy Native Shell");
            info.SetVersion("0.1.0 prototype");
            info.SetDescription("Isolated native UI feasibility spike. Not production.");
            wxAboutBox(info, this);
        });
        root->Add(heading, 0, wxALL, 20);
        root->Add(status, 0, wxLEFT | wxRIGHT | wxBOTTOM, 20);
        root->AddStretchSpacer(1);
        root->Add(about, 0, wxALL | wxALIGN_RIGHT, 20);
        panel->SetSizer(root);
        Centre();
    }
};

class SchoolBridgeApp final : public wxApp {
public:
    bool OnInit() override {
        auto* frame = new SchoolBridgeFrame();
        frame->Show();
        return true;
    }
};
wxIMPLEMENT_APP(SchoolBridgeApp);
